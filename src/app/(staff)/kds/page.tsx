'use client';
import { useEffect, useState } from 'react';
import Ably from 'ably';
import { motion } from 'motion/react';
import { trpc } from '@/lib/trpc-client';
import { PageHeader } from '@/components/ui/PageHeader';
import { LogoutButton } from '@/components/ui/LogoutButton';

// Explicit view of the JSON-serialized shape returned by order.listOpen.
// (A type derived directly from the Prisma/tRPC procedure output hits
// TS2589 "Type instantiation is excessively deep" here, because the
// nested include — items -> menuItem, plus Decimal/Json fields — pushes
// tRPC's output-serialization type past the compiler's recursion limit.
// This mirrors the real over-the-wire JSON shape.)
type KdsOrder = {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  table: { label: string } | null;
  items: {
    id: string;
    qty: number;
    kitchenStatus: 'QUEUED' | 'PREPARING' | 'READY' | 'SERVED';
    menuItem: { name: string };
  }[];
};

const STATUS_LABEL: Record<string, string> = {
  QUEUED: 'Queued',
  PREPARING: 'Preparing',
  READY: 'Ready',
  SERVED: 'Served',
};

const STATUS_BG: Record<string, string> = {
  QUEUED: 'bg-status-queued',
  PREPARING: 'bg-status-preparing',
  READY: 'bg-status-ready',
  SERVED: 'bg-status-ready',
};

const STATUS_BORDER: Record<string, string> = {
  QUEUED: 'border-status-queued',
  PREPARING: 'border-status-preparing',
  READY: 'border-status-ready',
  SERVED: 'border-status-ready',
};

// Tinted pill per item status, matching the design reference's per-state
// rgba backgrounds rather than one flat gray pill for every state.
const PILL_CLASS: Record<string, string> = {
  QUEUED: 'bg-status-queued/14 text-status-queued-pill-fg',
  PREPARING: 'bg-status-preparing/16 text-status-preparing-pill-fg',
  READY: 'bg-status-ready/16 text-status-ready-pill-fg',
  SERVED: 'bg-status-ready/16 text-status-ready-pill-fg',
};

const TYPE_BADGE: Record<string, { label: string; className: string }> = {
  DINE_IN: { label: 'Dine-in', className: 'bg-type-dinein-bg text-type-dinein-fg' },
  TAKEAWAY: { label: 'Takeaway', className: 'bg-type-takeaway-bg text-type-takeaway-fg' },
  DELIVERY: { label: 'Delivery', className: 'bg-type-delivery-bg text-type-delivery-fg' },
};

// Elapsed-time badge color: a continuous green -> amber -> red gradient
// instead of a flat "late past N minutes" cutoff, so ticket age reads as
// a gradient of urgency rather than an abrupt jump.
const URGENCY_STOPS: [number, string][] = [
  [0, '#5fbf7f'], // fresh -- status-ready green
  [10, '#e0a86a'], // status-preparing amber
  [20, '#e59a86'], // kds-late red
];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function urgencyColor(elapsedMin: number): string {
  const clamped = Math.min(Math.max(elapsedMin, 0), URGENCY_STOPS[URGENCY_STOPS.length - 1][0]);
  let lo = URGENCY_STOPS[0];
  let hi = URGENCY_STOPS[URGENCY_STOPS.length - 1];
  for (let i = 0; i < URGENCY_STOPS.length - 1; i++) {
    if (clamped >= URGENCY_STOPS[i][0] && clamped <= URGENCY_STOPS[i + 1][0]) {
      lo = URGENCY_STOPS[i];
      hi = URGENCY_STOPS[i + 1];
      break;
    }
  }
  const t = hi[0] === lo[0] ? 0 : (clamped - lo[0]) / (hi[0] - lo[0]);
  const [r1, g1, b1] = hexToRgb(lo[1]);
  const [r2, g2, b2] = hexToRgb(hi[1]);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

type FilterMode = 'INFLIGHT' | 'DELIVERED' | 'ALL';

const FILTERS: { key: FilterMode; label: string }[] = [
  { key: 'INFLIGHT', label: 'Inflight' },
  { key: 'DELIVERED', label: 'Delivered' },
  { key: 'ALL', label: 'All' },
];

export default function KdsPage() {
  const orders = trpc.order.listOpen.useQuery();
  const raw = orders.data as unknown as KdsOrder[] | undefined;
  // Default view hides delivered (bumped) tickets, same as before -- the
  // filter tabs below just make that a choice instead of the only option.
  const [filter, setFilter] = useState<FilterMode>('INFLIGHT');
  const data = raw?.filter((o) => {
    if (filter === 'INFLIGHT') return o.status !== 'SERVED';
    if (filter === 'DELIVERED') return o.status === 'SERVED';
    return true;
  });
  const inflightCount = raw?.filter((o) => o.status !== 'SERVED').length ?? 0;
  const deliveredCount = raw?.filter((o) => o.status === 'SERVED').length ?? 0;
  const filterCount: Record<FilterMode, number> = {
    INFLIGHT: inflightCount,
    DELIVERED: deliveredCount,
    ALL: raw?.length ?? 0,
  };

  // Drives the elapsed-time badge on each ticket -- re-ticking every 30s is
  // enough to keep "X min" honest without a per-second render cost.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const client = new Ably.Realtime({ authUrl: '/api/ably-token' });
    const channel = client.channels.get('orders');
    const refetch = () => orders.refetch();
    // channel.subscribe's implicit attach returns a promise that rejects
    // if the client is closed before it settles (StrictMode's dev-only
    // double-invoke of effects triggers exactly that). We never await it,
    // so an unhandled rejection would otherwise surface as a runtime
    // error even though teardown below is already handling this case.
    channel.subscribe(refetch)?.catch(() => {});
    return () => {
      try {
        channel.unsubscribe(refetch);
        client.close();
      } catch {
        // Ably can throw tearing down a connection that hasn't finished
        // connecting yet (e.g. React StrictMode's dev-only double-invoke
        // of effects). Teardown is best-effort — nothing downstream reads
        // whether it succeeded.
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateStatus = trpc.kitchen.updateItemStatus.useMutation({ onSuccess: () => orders.refetch() });
  // Refetch is delayed on success (not fired immediately) so the checkmark
  // overlay below gets a beat to actually play before the ticket vanishes
  // from the board -- an instant refetch would yank the card away mid-animation.
  const markServed = trpc.kitchen.markServed.useMutation();
  // Neither mutation had any visible failure feedback before -- a rejected
  // call (e.g. a role the backend doesn't allow) just did nothing, which is
  // exactly how "Bump - delivered" silently failing for KITCHEN went unnoticed.
  const [errorOrderId, setErrorOrderId] = useState<string | null>(null);
  const [bumpedOrderId, setBumpedOrderId] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-kds-bg text-kds-text">
      <PageHeader title="Kitchen Display" subtitle="Kopi & Co · Live" dark right={<LogoutButton dark />} />
      <main className="p-5">
        <div className="flex gap-2 mb-4">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl font-extrabold text-sm border transition-colors ${
                  active
                    ? 'bg-accent border-accent text-white'
                    : 'bg-kds-card border-kds-border text-kds-text-muted-2 hover:bg-kds-card-header'
                }`}
              >
                {f.label}
                <span
                  className={`text-[11px] font-extrabold px-1.5 py-0.5 rounded-full ${
                    active ? 'bg-white/20 text-white' : 'bg-kds-bg text-kds-text-muted'
                  }`}
                >
                  {filterCount[f.key]}
                </span>
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(308px,1fr))] gap-4 items-start">
          {data?.map((order) => {
            const elapsedMin = Math.max(0, Math.round((now - new Date(order.createdAt).getTime()) / 60_000));
            const typeBadge = TYPE_BADGE[order.type];
            const allReady = order.items.length > 0 && order.items.every((i) => i.kitchenStatus === 'READY' || i.kitchenStatus === 'SERVED');
            const isDelivered = order.status === 'SERVED';
            // Ready tickets stay green regardless of age -- they're done,
            // not urgent. Everything still in progress uses the same
            // urgency gradient as the elapsed-time badge, so the whole
            // card (not just the timer) signals how long it's been waiting.
            // Delivered tickets drop to a flat dark tone instead -- no
            // urgency left to signal, and it visually recedes against the
            // still-inflight (bright) cards when the All filter mixes both.
            const topColor = isDelivered ? '#3a332a' : allReady ? '#5fbf7f' : urgencyColor(elapsedMin);
            return (
              <div
                key={order.id}
                className={`relative flex flex-col min-h-[220px] border border-kds-border border-t-4 rounded-2xl overflow-hidden ${
                  isDelivered ? 'bg-kds-bg opacity-80' : 'bg-kds-card shadow-lg shadow-black/20'
                }`}
                style={{ borderTopColor: topColor }}
              >
                {bumpedOrderId === order.id && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="absolute inset-0 z-10 bg-kds-bg/95 flex flex-col items-center justify-center gap-2"
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 260, damping: 16 }}
                      className="w-14 h-14 rounded-full bg-success flex items-center justify-center"
                    >
                      <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <motion.path
                          d="M5 13l4 4L19 7"
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{ duration: 0.35, delay: 0.15, ease: 'easeOut' }}
                        />
                      </svg>
                    </motion.div>
                    <div className="font-extrabold text-sm text-kds-text">Delivered</div>
                  </motion.div>
                )}
                <div className="flex items-start justify-between gap-2 px-3.5 py-3 bg-kds-card-header border-b border-kds-border-header">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-[10px] font-extrabold uppercase tracking-wide px-2 py-1 rounded-md shrink-0 ${typeBadge?.className ?? 'bg-kds-bg text-kds-text-muted-2'}`}>
                      {typeBadge?.label ?? order.type}
                    </span>
                    <span className="text-base font-extrabold text-kds-text truncate">{order.table?.label ?? typeBadge?.label ?? order.type}</span>
                  </div>
                  <div className="flex flex-col items-end leading-tight shrink-0">
                    <span className="text-[11px] font-extrabold text-kds-text">#{order.id.slice(-4).toUpperCase()}</span>
                    <span
                      className="text-xs font-extrabold"
                      style={{ color: isDelivered ? undefined : urgencyColor(elapsedMin) }}
                    >
                      {isDelivered ? (
                        <span className="text-kds-text-muted">delivered</span>
                      ) : (
                        `${elapsedMin} min`
                      )}
                    </span>
                  </div>
                </div>
                <div className="p-1.5 flex-1">
                  {/* Sorted by name only (never by status), so an item doesn't
                      jump position in the list when its status changes. */}
                  {[...order.items]
                    .sort((a, b) => a.menuItem.name.localeCompare(b.menuItem.name))
                    .map((item) => {
                    const isTerminal = item.kitchenStatus === 'READY' || item.kitchenStatus === 'SERVED';
                    return (
                      <div key={item.id} className="px-2 py-2.5 border-b border-kds-border-row last:border-b-0">
                        <div className="flex items-center gap-2.5">
                          {item.kitchenStatus === 'SERVED' ? (
                            <span
                              className={`w-[22px] h-[22px] shrink-0 rounded-md border-2 flex items-center justify-center text-xs font-black ${STATUS_BORDER[item.kitchenStatus]} ${STATUS_BG[item.kitchenStatus]} text-kds-bg`}
                            >
                              ✓
                            </span>
                          ) : (
                            <button
                              onClick={() => {
                                setErrorOrderId(order.id);
                                updateStatus.mutate({ orderItemId: item.id, status: item.kitchenStatus === 'READY' ? 'PREPARING' : 'READY' });
                              }}
                              aria-label={item.kitchenStatus === 'READY' ? `Undo ready for ${item.menuItem.name}` : `Mark ${item.menuItem.name} ready`}
                              title={item.kitchenStatus === 'READY' ? 'Click to undo' : 'Click to mark ready'}
                              className={`w-[22px] h-[22px] shrink-0 rounded-md border-2 flex items-center justify-center text-xs font-black cursor-pointer hover:opacity-70 ${STATUS_BORDER[item.kitchenStatus]} ${
                                isTerminal ? `${STATUS_BG[item.kitchenStatus]} text-kds-bg` : 'text-transparent'
                              }`}
                            >
                              ✓
                            </button>
                          )}
                          <span className="font-extrabold text-sm min-w-[24px]">{item.qty}×</span>
                          <span className={`flex-1 text-sm font-bold ${isTerminal ? 'text-kds-text-muted line-through' : 'text-kds-text'}`}>
                            {item.menuItem.name}
                          </span>
                          <span className={`text-[10.5px] font-extrabold uppercase px-2 py-0.5 rounded-full shrink-0 ${PILL_CLASS[item.kitchenStatus]}`}>
                            {STATUS_LABEL[item.kitchenStatus]}
                          </span>
                        </div>
                        {item.kitchenStatus === 'QUEUED' && (
                          <div className="mt-2 pl-[32px]">
                            <button
                              onClick={() => {
                                setErrorOrderId(order.id);
                                updateStatus.mutate({ orderItemId: item.id, status: 'PREPARING' });
                              }}
                              className="w-full py-1.5 rounded-lg bg-kds-card-header text-kds-text-muted-2 text-xs font-bold focus-visible:ring-2 focus-visible:ring-status-ready focus-visible:ring-offset-1 focus-visible:ring-offset-kds-bg"
                            >
                              Preparing
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="p-2.5 mt-auto">
                  {isDelivered ? (
                    <div className="w-full py-3 rounded-xl font-extrabold text-sm text-center text-kds-text-muted bg-kds-card-header">
                      Delivered
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setErrorOrderId(order.id);
                        if (allReady) {
                          setBumpedOrderId(order.id);
                          markServed.mutate(
                            { orderId: order.id },
                            { onSuccess: () => setTimeout(() => orders.refetch(), 700) }
                          );
                        } else {
                          order.items
                            .filter((i) => i.kitchenStatus !== 'READY' && i.kitchenStatus !== 'SERVED')
                            .forEach((i) => updateStatus.mutate({ orderItemId: i.id, status: 'READY' }));
                        }
                      }}
                      className={`w-full py-3 rounded-xl font-extrabold text-sm text-white ${allReady ? 'bg-success' : 'bg-accent'}`}
                    >
                      {allReady ? 'Bump · delivered' : 'Mark all ready'}
                    </button>
                  )}
                  {errorOrderId === order.id && (updateStatus.isError || markServed.isError) && (
                    <p className="text-[11px] font-semibold text-kds-late mt-2 text-center">
                      {(markServed.error ?? updateStatus.error)?.message}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
          {data?.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center gap-3 py-14 px-6 text-kds-text-muted text-center">
              <div className="w-14 h-14 rounded-2xl bg-kds-card flex items-center justify-center text-2xl">🍳</div>
              <div className="font-extrabold text-kds-text-muted-2">All caught up</div>
              <div className="text-xs">No open tickets right now.</div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

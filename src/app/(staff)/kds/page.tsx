'use client';
import { useEffect, useState } from 'react';
import Ably from 'ably';
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

const TYPE_BADGE: Record<string, { label: string; className: string }> = {
  DINE_IN: { label: 'Dine-in', className: 'bg-type-dinein-bg text-type-dinein-fg' },
  TAKEAWAY: { label: 'Takeaway', className: 'bg-type-takeaway-bg text-type-takeaway-fg' },
  DELIVERY: { label: 'Delivery', className: 'bg-type-delivery-bg text-type-delivery-fg' },
};

function orderAccent(items: KdsOrder['items']) {
  if (items.length > 0 && items.every((i) => i.kitchenStatus === 'READY' || i.kitchenStatus === 'SERVED')) {
    return 'border-t-status-ready';
  }
  if (items.some((i) => i.kitchenStatus === 'PREPARING')) return 'border-t-status-preparing';
  return 'border-t-status-queued';
}

export default function KdsPage() {
  const orders = trpc.order.listOpen.useQuery();
  const data = orders.data as unknown as KdsOrder[] | undefined;

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
    channel.subscribe(refetch);
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

  return (
    <div className="min-h-screen bg-kds-bg text-kds-text">
      <PageHeader title="Kitchen Display" subtitle="Kopi & Co · Live" dark right={<LogoutButton dark />} />
      <main className="p-5 overflow-x-auto">
        <div className="grid grid-flow-col auto-cols-[85vw] sm:auto-cols-[308px] gap-4 items-start">
          {data?.map((order) => {
            const elapsedMin = Math.max(0, Math.round((now - new Date(order.createdAt).getTime()) / 60_000));
            const isLate = elapsedMin >= 10;
            const typeBadge = TYPE_BADGE[order.type];
            return (
              <div
                key={order.id}
                className={`flex flex-col min-h-[220px] bg-kds-card border border-kds-border border-t-4 ${orderAccent(order.items)} rounded-2xl shadow-lg shadow-black/20 overflow-hidden`}
              >
                <div className="flex items-start justify-between gap-2 px-3.5 py-3 bg-kds-card-header border-b border-kds-border">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-[10px] font-extrabold uppercase tracking-wide px-2 py-1 rounded-md shrink-0 ${typeBadge?.className ?? 'bg-kds-bg text-kds-text-muted-2'}`}>
                      {typeBadge?.label ?? order.type}
                    </span>
                    <span className="text-base font-extrabold text-kds-text truncate">{order.table?.label ?? typeBadge?.label ?? order.type}</span>
                  </div>
                  <div className="flex flex-col items-end leading-tight shrink-0">
                    <span className="text-[11px] font-extrabold text-kds-text">#{order.id.slice(-4).toUpperCase()}</span>
                    <span className={`text-xs font-extrabold ${isLate ? 'text-warning' : 'text-kds-text-muted'}`}>{elapsedMin} min</span>
                  </div>
                </div>
                <div className="p-1.5 flex-1">
                  {order.items.map((item) => {
                    const isTerminal = item.kitchenStatus === 'READY' || item.kitchenStatus === 'SERVED';
                    return (
                      <div key={item.id} className="px-2 py-2.5 border-b border-kds-border last:border-b-0">
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`w-[22px] h-[22px] shrink-0 rounded-md border-2 flex items-center justify-center text-xs font-black ${STATUS_BORDER[item.kitchenStatus]} ${
                              isTerminal ? `${STATUS_BG[item.kitchenStatus]} text-kds-bg` : 'text-transparent'
                            }`}
                          >
                            ✓
                          </span>
                          <span className="font-extrabold text-sm min-w-[24px]">{item.qty}×</span>
                          <span className={`flex-1 text-sm font-bold ${isTerminal ? 'text-kds-text-muted line-through' : 'text-kds-text'}`}>
                            {item.menuItem.name}
                          </span>
                          <span className="text-[10.5px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-kds-card-header text-kds-text-muted-2 shrink-0">
                            {STATUS_LABEL[item.kitchenStatus]}
                          </span>
                        </div>
                        {!isTerminal && (
                          <div className="flex gap-1.5 mt-2 pl-[32px]">
                            <button
                              onClick={() => updateStatus.mutate({ orderItemId: item.id, status: 'PREPARING' })}
                              className="flex-1 py-1.5 rounded-lg bg-kds-card-header text-kds-text-muted-2 text-xs font-bold focus-visible:ring-2 focus-visible:ring-status-ready focus-visible:ring-offset-1 focus-visible:ring-offset-kds-bg"
                            >
                              Preparing
                            </button>
                            <button
                              onClick={() => updateStatus.mutate({ orderItemId: item.id, status: 'READY' })}
                              className="flex-1 py-1.5 rounded-lg bg-status-ready text-kds-bg text-xs font-bold focus-visible:ring-2 focus-visible:ring-status-ready focus-visible:ring-offset-1 focus-visible:ring-offset-kds-bg"
                            >
                              Ready
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {data?.length === 0 && (
            <div className="w-[85vw] sm:w-[308px] flex flex-col items-center justify-center gap-3 py-14 px-6 text-kds-text-muted text-center">
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

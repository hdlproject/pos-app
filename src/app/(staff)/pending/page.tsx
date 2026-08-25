'use client';
import Link from 'next/link';
import { useState } from 'react';
import { motion } from 'motion/react';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { LogoutButton } from '@/components/ui/LogoutButton';

// Explicit view of the JSON-serialized shape returned by
// order.listPendingDispatch. Same TS2589 workaround as the KDS/order
// pages -- the full inferred Prisma shape (items -> menuItem, payments,
// children, Decimal fields) is too deep for the compiler here.
type PendingOrder = {
  id: string;
  type: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  source: 'STAFF' | 'QR';
  parentOrderId: string | null;
  isOpenTableSession: boolean;
  sessionFinished: boolean;
  total: string;
  createdAt: string;
  table: { label: string } | null;
  items: { id: string; qty: number; menuItem: { name: string } }[];
  payments: { id: string; amount: string }[];
  children: { id: string; total: string }[];
};

const TYPE_LABEL: Record<string, string> = {
  DINE_IN: 'Dine-in',
  TAKEAWAY: 'Takeaway',
  DELIVERY: 'Delivery',
};

// One row per open-table session, holding only the rounds still waiting
// to be dispatched (listPendingDispatch only returns OPEN orders, so
// every round here is by definition undispatched). parent.children still
// carries every round -- dispatched or not -- which is what the bill
// total is summed from.
type Group = { parent: PendingOrder; pendingRounds: PendingOrder[] };
type Entry = { sortKey: number } & ({ kind: 'group' } & Group | { kind: 'standalone'; order: PendingOrder });

export default function PendingPurchasesPage() {
  const orders = trpc.order.listPendingDispatch.useQuery();
  const data = orders.data as unknown as PendingOrder[] | undefined;
  // Refetch is delayed on success so the checkmark overlay below gets a
  // beat to play before the card actually leaves the list -- same pattern
  // as the KDS bump animation. sendToKitchen means something different
  // depending on the row -- dispatch for an ordinary order or an
  // open-table round, or the one closing payment for a finished
  // open-table's parent -- but it's the same mutation call either way,
  // the backend branches on what the order actually is.
  const sendToKitchen = trpc.order.sendToKitchen.useMutation();
  const cancel = trpc.order.cancel.useMutation();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [dispatchedId, setDispatchedId] = useState<string | null>(null);
  const [cancelledId, setCancelledId] = useState<string | null>(null);

  function dispatch(orderId: string) {
    setConfirmingId(orderId);
    sendToKitchen.mutate(
      { orderId },
      {
        onSuccess: () => {
          setDispatchedId(orderId);
          setTimeout(() => orders.refetch(), 700);
        },
      }
    );
  }

  function cancelOrder(orderId: string) {
    setCancellingId(orderId);
    cancel.mutate(
      { orderId, reason: 'Cancelled from pending purchases' },
      {
        onSuccess: () => {
          setCancelledId(orderId);
          setTimeout(() => orders.refetch(), 700);
        },
      }
    );
  }

  const entries: Entry[] = data
    ? (() => {
        const parents = data.filter((o) => o.isOpenTableSession);
        const rounds = data.filter((o) => o.parentOrderId);
        const standalone = data.filter((o) => !o.isOpenTableSession && !o.parentOrderId);
        const groups: Entry[] = parents.map((parent) => ({
          kind: 'group' as const,
          parent,
          pendingRounds: rounds
            .filter((r) => r.parentOrderId === parent.id)
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
          sortKey: new Date(parent.createdAt).getTime(),
        }));
        const standaloneEntries: Entry[] = standalone.map((order) => ({
          kind: 'standalone' as const,
          order,
          sortKey: new Date(order.createdAt).getTime(),
        }));
        return [...groups, ...standaloneEntries].sort((a, b) => a.sortKey - b.sortKey);
      })()
    : [];

  return (
    <div className="min-h-screen bg-bg">
      <PageHeader
        title="Pending Purchases"
        subtitle="Awaiting confirmation"
        right={
          <>
            <Link
              href="/pos"
              className="pl-3.5 pr-3 py-2 rounded-xl font-extrabold text-sm border bg-surface text-text-muted-2 border-border-strong hover:bg-surface-input transition-colors"
            >
              Back to POS
            </Link>
            <LogoutButton />
          </>
        }
      />
      <main className="max-w-2xl mx-auto p-6 flex flex-col gap-3">
        {entries.length === 0 && data && (
          <div className="flex flex-col items-center justify-center gap-2 text-center px-8 py-16 text-text-muted">
            <div className="w-12 h-12 rounded-2xl bg-surface-input flex items-center justify-center text-xl">🧾</div>
            <div className="font-bold text-text-muted-2">Nothing pending</div>
            <div className="text-xs">Charge-first orders, open-table tabs, and finished bills show up here.</div>
          </div>
        )}

        {entries.map((entry) =>
          entry.kind === 'standalone' ? (
            <StandaloneCard
              key={entry.order.id}
              order={entry.order}
              dispatching={confirmingId === entry.order.id && sendToKitchen.isPending}
              dispatchedId={dispatchedId}
              cancelledId={cancelledId}
              cancelling={cancellingId === entry.order.id && cancel.isPending}
              dispatchError={confirmingId === entry.order.id ? sendToKitchen.error?.message : undefined}
              cancelError={cancellingId === entry.order.id ? cancel.error?.message : undefined}
              onDispatch={dispatch}
              onCancel={cancelOrder}
            />
          ) : (
            <GroupCard
              key={entry.parent.id}
              parent={entry.parent}
              pendingRounds={entry.pendingRounds}
              confirmingId={confirmingId}
              cancellingId={cancellingId}
              dispatchedId={dispatchedId}
              cancelledId={cancelledId}
              sendToKitchenPending={sendToKitchen.isPending}
              cancelPending={cancel.isPending}
              dispatchError={sendToKitchen.error?.message}
              cancelError={cancel.error?.message}
              onDispatch={dispatch}
              onCancel={cancelOrder}
            />
          )
        )}
      </main>
    </div>
  );
}

function SuccessOverlay({ label, tone }: { label: string; tone: 'success' | 'warning' }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 z-10 bg-surface/95 flex flex-col items-center justify-center gap-2 rounded-[inherit]"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 16 }}
        className={`w-10 h-10 rounded-full flex items-center justify-center ${tone === 'success' ? 'bg-success' : 'bg-warning'}`}
      >
        <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          {tone === 'success' ? (
            <motion.path
              d="M5 13l4 4L19 7"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.35, delay: 0.15, ease: 'easeOut' }}
            />
          ) : (
            <motion.path
              d="M6 6l12 12M18 6L6 18"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.35, delay: 0.15, ease: 'easeOut' }}
            />
          )}
        </svg>
      </motion.div>
      <div className="font-extrabold text-xs text-text">{label}</div>
    </motion.div>
  );
}

function StandaloneCard({
  order,
  dispatching,
  cancelling,
  dispatchedId,
  cancelledId,
  dispatchError,
  cancelError,
  onDispatch,
  onCancel,
}: {
  order: PendingOrder;
  dispatching: boolean;
  cancelling: boolean;
  dispatchedId: string | null;
  cancelledId: string | null;
  dispatchError?: string;
  cancelError?: string;
  onDispatch: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  return (
    <Card className="relative overflow-hidden flex flex-col gap-3">
      {dispatchedId === order.id && <SuccessOverlay label="Sent to kitchen" tone="success" />}
      {cancelledId === order.id && <SuccessOverlay label="Cancelled" tone="warning" />}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-bold text-text text-sm flex items-center gap-1.5">
            {TYPE_LABEL[order.type]}
            {order.table ? ` · ${order.table.label}` : ''}
            {order.source === 'QR' && (
              <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded-full bg-accent-tint/15 text-accent-tint">
                QR
              </span>
            )}
          </div>
          <div className="text-xs text-text-muted mt-0.5">
            {order.items.map((i) => `${i.qty}× ${i.menuItem.name}`).join(', ')}
          </div>
        </div>
        <span className="shrink-0 text-[10.5px] font-extrabold uppercase px-2 py-1 rounded-full bg-surface-input text-text-muted-2">
          Placed {new Date(order.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
        <div className="flex items-center gap-2">
          <div className="font-extrabold text-accent">Rp {Number(order.total).toLocaleString('id-ID')}</div>
          {order.payments.length > 0 ? (
            <span className="text-[10.5px] font-extrabold uppercase px-2 py-1 rounded-full bg-success/15 text-success">
              Paid
            </span>
          ) : (
            <span className="text-[10.5px] font-extrabold uppercase px-2 py-1 rounded-full bg-surface-input text-text-muted-2">
              Awaiting payment
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={cancelling} onClick={() => onCancel(order.id)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={dispatching} onClick={() => onDispatch(order.id)}>
            Confirm &amp; send to kitchen
          </Button>
        </div>
      </div>
      {cancelError && <p className="text-warning text-xs font-semibold text-right">{cancelError}</p>}
      {dispatchError && <p className="text-warning text-xs font-semibold text-right">{dispatchError}</p>}
    </Card>
  );
}

function GroupCard({
  parent,
  pendingRounds,
  confirmingId,
  cancellingId,
  dispatchedId,
  cancelledId,
  sendToKitchenPending,
  cancelPending,
  dispatchError,
  cancelError,
  onDispatch,
  onCancel,
}: {
  parent: PendingOrder;
  pendingRounds: PendingOrder[];
  confirmingId: string | null;
  cancellingId: string | null;
  dispatchedId: string | null;
  cancelledId: string | null;
  sendToKitchenPending: boolean;
  cancelPending: boolean;
  dispatchError?: string;
  cancelError?: string;
  onDispatch: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const billTotal = parent.children.reduce((sum, c) => sum + Number(c.total), 0);
  const dispatchedRoundCount = parent.children.length - pendingRounds.length;
  const canConfirmPayment = parent.sessionFinished && pendingRounds.length === 0;

  return (
    <Card className="relative overflow-hidden flex flex-col gap-3">
      {cancelledId === parent.id && <SuccessOverlay label="Table bill cancelled" tone="warning" />}
      {dispatchedId === parent.id && <SuccessOverlay label="Payment confirmed" tone="success" />}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-bold text-text text-sm flex items-center gap-1.5">
            Table Bill
            {parent.table ? ` · ${parent.table.label}` : ''}
            <span
              className={`text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded-full ${
                parent.sessionFinished ? 'bg-accent/15 text-accent' : 'bg-surface-input text-text-muted-2'
              }`}
            >
              {parent.sessionFinished ? 'Finished' : 'Open'}
            </span>
          </div>
          <div className="text-xs text-text-muted mt-0.5">
            {parent.children.length} round{parent.children.length === 1 ? '' : 's'}
            {dispatchedRoundCount > 0 && ` · ${dispatchedRoundCount} sent to kitchen`}
          </div>
        </div>
        <span className="shrink-0 text-[10.5px] font-extrabold uppercase px-2 py-1 rounded-full bg-surface-input text-text-muted-2">
          Opened {new Date(parent.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {pendingRounds.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border pt-2.5">
          {pendingRounds.map((round) => (
            <div
              key={round.id}
              className="relative overflow-hidden flex items-center justify-between gap-2 bg-surface-input rounded-xl px-3 py-2"
            >
              {dispatchedId === round.id && <SuccessOverlay label="Sent to kitchen" tone="success" />}
              {cancelledId === round.id && <SuccessOverlay label="Round cancelled" tone="warning" />}
              <div className="min-w-0">
                <div className="text-xs font-bold text-text-muted-2 truncate">
                  {round.items.map((i) => `${i.qty}× ${i.menuItem.name}`).join(', ')}
                </div>
                <div className="text-[10.5px] text-text-muted font-semibold">
                  Rp {Number(round.total).toLocaleString('id-ID')}
                </div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={cancelPending}
                  onClick={() => onCancel(round.id)}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={sendToKitchenPending}
                  onClick={() => onDispatch(round.id)}
                >
                  Send to kitchen
                </Button>
              </div>
              {cancellingId === round.id && cancelError && (
                <p className="text-warning text-[10.5px] font-semibold absolute -bottom-4 right-2">{cancelError}</p>
              )}
              {confirmingId === round.id && dispatchError && (
                <p className="text-warning text-[10.5px] font-semibold absolute -bottom-4 right-2">{dispatchError}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
        <div className="font-extrabold text-accent">Rp {billTotal.toLocaleString('id-ID')}</div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={cancelPending}
            onClick={() => onCancel(parent.id)}
          >
            Cancel table
          </Button>
          {parent.sessionFinished ? (
            <Button
              variant="primary"
              size="sm"
              disabled={sendToKitchenPending || !canConfirmPayment}
              onClick={() => onDispatch(parent.id)}
              title={canConfirmPayment ? undefined : 'Send every round to the kitchen first'}
            >
              Confirm payment
            </Button>
          ) : (
            <span className="text-[10.5px] font-extrabold uppercase px-2 py-1 rounded-full bg-surface-input text-text-muted-2">
              Awaiting customer
            </span>
          )}
        </div>
      </div>
      {cancellingId === parent.id && cancelError && (
        <p className="text-warning text-xs font-semibold text-right">{cancelError}</p>
      )}
      {confirmingId === parent.id && dispatchError && (
        <p className="text-warning text-xs font-semibold text-right">{dispatchError}</p>
      )}
    </Card>
  );
}

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
        {data?.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 text-center px-8 py-16 text-text-muted">
            <div className="w-12 h-12 rounded-2xl bg-surface-input flex items-center justify-center text-xl">🧾</div>
            <div className="font-bold text-text-muted-2">Nothing pending</div>
            <div className="text-xs">Charge-first orders, open-table rounds, and finished tabs show up here.</div>
          </div>
        )}
        {data
          ?.slice()
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
          .map((order) => {
            const isParent = order.isOpenTableSession;
            const isChild = !!order.parentOrderId;
            const displayTotal = isParent
              ? order.children.reduce((sum, c) => sum + Number(c.total), 0)
              : Number(order.total);
            const actionLabel = isParent ? 'Confirm payment' : isChild ? 'Send to kitchen' : 'Confirm & send to kitchen';
            const successLabel = isParent ? 'Payment confirmed' : 'Sent to kitchen';
            return (
              <Card key={order.id} className="relative overflow-hidden flex flex-col gap-3">
                {dispatchedId === order.id && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="absolute inset-0 z-10 bg-surface/95 flex flex-col items-center justify-center gap-2"
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 260, damping: 16 }}
                      className="w-12 h-12 rounded-full bg-success flex items-center justify-center"
                    >
                      <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <motion.path
                          d="M5 13l4 4L19 7"
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{ duration: 0.35, delay: 0.15, ease: 'easeOut' }}
                        />
                      </svg>
                    </motion.div>
                    <div className="font-extrabold text-sm text-text">{successLabel}</div>
                  </motion.div>
                )}
                {cancelledId === order.id && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="absolute inset-0 z-10 bg-surface/95 flex flex-col items-center justify-center gap-2"
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 260, damping: 16 }}
                      className="w-12 h-12 rounded-full bg-warning flex items-center justify-center"
                    >
                      <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <motion.path
                          d="M6 6l12 12M18 6L6 18"
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{ duration: 0.35, delay: 0.15, ease: 'easeOut' }}
                        />
                      </svg>
                    </motion.div>
                    <div className="font-extrabold text-sm text-text">Cancelled</div>
                  </motion.div>
                )}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-text text-sm flex items-center gap-1.5">
                      {isParent ? 'Table Bill' : TYPE_LABEL[order.type]}
                      {order.table ? ` · ${order.table.label}` : ''}
                      {isParent && (
                        <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded-full bg-accent/15 text-accent">
                          Finished
                        </span>
                      )}
                      {isChild && (
                        <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded-full bg-accent-tint/15 text-accent-tint">
                          Round
                        </span>
                      )}
                      {!isParent && !isChild && order.source === 'QR' && (
                        <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded-full bg-accent-tint/15 text-accent-tint">
                          QR
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-text-muted mt-0.5">
                      {isParent
                        ? `${order.children.length} round${order.children.length === 1 ? '' : 's'}`
                        : order.items.map((i) => `${i.qty}× ${i.menuItem.name}`).join(', ')}
                    </div>
                  </div>
                  <span className="shrink-0 text-[10.5px] font-extrabold uppercase px-2 py-1 rounded-full bg-surface-input text-text-muted-2">
                    Placed {new Date(order.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
                  <div className="flex items-center gap-2">
                    <div className="font-extrabold text-accent">Rp {displayTotal.toLocaleString('id-ID')}</div>
                    {!isParent && !isChild && (
                      order.payments.length > 0 ? (
                        <span className="text-[10.5px] font-extrabold uppercase px-2 py-1 rounded-full bg-success/15 text-success">
                          Paid
                        </span>
                      ) : (
                        <span className="text-[10.5px] font-extrabold uppercase px-2 py-1 rounded-full bg-surface-input text-text-muted-2">
                          Awaiting payment
                        </span>
                      )
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={cancel.isPending}
                      onClick={() => {
                        setCancellingId(order.id);
                        cancel.mutate(
                          { orderId: order.id, reason: 'Cancelled from pending purchases' },
                          {
                            onSuccess: () => {
                              setCancelledId(order.id);
                              setTimeout(() => orders.refetch(), 700);
                            },
                          }
                        );
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={sendToKitchen.isPending}
                      onClick={() => {
                        setConfirmingId(order.id);
                        sendToKitchen.mutate(
                          { orderId: order.id },
                          {
                            onSuccess: () => {
                              setDispatchedId(order.id);
                              setTimeout(() => orders.refetch(), 700);
                            },
                          }
                        );
                      }}
                    >
                      {actionLabel}
                    </Button>
                  </div>
                </div>
                {cancel.isError && cancellingId === order.id && (
                  <p className="text-warning text-xs font-semibold text-right">{cancel.error.message}</p>
                )}
                {sendToKitchen.isError && confirmingId === order.id && (
                  <p className="text-warning text-xs font-semibold text-right">{sendToKitchen.error.message}</p>
                )}
              </Card>
            );
          })}
      </main>
    </div>
  );
}

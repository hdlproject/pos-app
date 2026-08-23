'use client';
import Link from 'next/link';
import { useState } from 'react';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { LogoutButton } from '@/components/ui/LogoutButton';

// Explicit view of the JSON-serialized shape returned by
// order.listPendingDispatch. Same TS2589 workaround as the KDS/order
// pages -- the full inferred Prisma shape (items -> menuItem, payments,
// Decimal fields) is too deep for the compiler here.
type PendingOrder = {
  id: string;
  type: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  total: string;
  createdAt: string;
  table: { label: string } | null;
  items: { id: string; qty: number; menuItem: { name: string } }[];
  payments: { id: string; amount: string }[];
};

const TYPE_LABEL: Record<string, string> = {
  DINE_IN: 'Dine-in',
  TAKEAWAY: 'Takeaway',
  DELIVERY: 'Delivery',
};

export default function PendingPurchasesPage() {
  const orders = trpc.order.listPendingDispatch.useQuery();
  const data = orders.data as unknown as PendingOrder[] | undefined;
  const sendToKitchen = trpc.order.sendToKitchen.useMutation({ onSuccess: () => orders.refetch() });
  const cancel = trpc.order.cancel.useMutation({ onSuccess: () => orders.refetch() });
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-bg">
      <PageHeader
        title="Pending Purchases"
        subtitle="Paid, awaiting kitchen dispatch"
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
            <div className="text-xs">Charge-first orders show up here until confirmed.</div>
          </div>
        )}
        {data?.map((order) => {
          const paidAmount = order.payments.reduce((s, p) => s + Number(p.amount), 0);
          return (
            <Card key={order.id} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold text-text text-sm">
                    {TYPE_LABEL[order.type]}
                    {order.table ? ` · ${order.table.label}` : ''}
                  </div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {order.items.map((i) => `${i.qty}× ${i.menuItem.name}`).join(', ')}
                  </div>
                </div>
                <span className="shrink-0 text-[10.5px] font-extrabold uppercase px-2 py-1 rounded-full bg-success/15 text-success">
                  Paid Rp {paidAmount.toLocaleString('id-ID')}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
                <div className="font-extrabold text-accent">Rp {Number(order.total).toLocaleString('id-ID')}</div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={cancel.isPending}
                    onClick={() => {
                      setCancellingId(order.id);
                      cancel.mutate({ orderId: order.id, reason: 'Cancelled from pending purchases' });
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
                      sendToKitchen.mutate({ orderId: order.id });
                    }}
                  >
                    Confirm &amp; send to kitchen
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

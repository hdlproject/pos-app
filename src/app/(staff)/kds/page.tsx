'use client';
import { useEffect } from 'react';
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

const STATUS_DOT: Record<string, string> = {
  QUEUED: 'bg-status-queued',
  PREPARING: 'bg-status-preparing',
  READY: 'bg-status-ready',
  SERVED: 'bg-status-ready',
};

export default function KdsPage() {
  const orders = trpc.order.listOpen.useQuery();
  const data = orders.data as unknown as KdsOrder[] | undefined;

  useEffect(() => {
    const client = new Ably.Realtime({ authUrl: '/api/ably-token' });
    const channel = client.channels.get('orders');
    const refetch = () => orders.refetch();
    channel.subscribe(refetch);
    return () => {
      channel.unsubscribe(refetch);
      client.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateStatus = trpc.kitchen.updateItemStatus.useMutation({ onSuccess: () => orders.refetch() });

  return (
    <div className="min-h-screen bg-kds-bg text-kds-text">
      <PageHeader title="Kitchen Display" subtitle="Kopi & Co · Live" dark right={<LogoutButton dark />} />
      <main className="p-5 overflow-x-auto">
        <div className="grid grid-flow-col auto-cols-[308px] gap-4 items-start">
          {data?.map((order) => (
            <div key={order.id} className="flex flex-col min-h-[220px] bg-kds-card border border-kds-border rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-kds-card-header border-b border-kds-border">
                <span className="text-base font-extrabold text-kds-text">{order.table?.label ?? order.type}</span>
                <span className="text-[11px] font-bold uppercase tracking-wide text-kds-text-muted">{order.status}</span>
              </div>
              <div className="p-1.5 flex-1">
                {order.items.map((item) => {
                  const isTerminal = item.kitchenStatus === 'READY' || item.kitchenStatus === 'SERVED';
                  return (
                    <div key={item.id} className="flex items-center gap-2.5 px-2 py-2.5 border-b border-kds-border">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[item.kitchenStatus]}`} />
                      <span className="font-extrabold text-sm min-w-[24px]">{item.qty}×</span>
                      <span className={`flex-1 text-sm font-bold ${isTerminal ? 'text-kds-text-muted line-through' : 'text-kds-text'}`}>
                        {item.menuItem.name}
                      </span>
                      <span className="text-[10.5px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-kds-card-header text-kds-text-muted-2">
                        {STATUS_LABEL[item.kitchenStatus]}
                      </span>
                      {!isTerminal && (
                        <div className="flex gap-1.5 ml-1">
                          <button
                            onClick={() => updateStatus.mutate({ orderItemId: item.id, status: 'PREPARING' })}
                            className="px-2 py-1 rounded-lg bg-kds-card-header text-kds-text-muted-2 text-[11px] font-bold focus-visible:ring-2 focus-visible:ring-status-ready focus-visible:ring-offset-1 focus-visible:ring-offset-kds-bg"
                          >
                            Preparing
                          </button>
                          <button
                            onClick={() => updateStatus.mutate({ orderItemId: item.id, status: 'READY' })}
                            className="px-2 py-1 rounded-lg bg-status-ready text-kds-bg text-[11px] font-bold focus-visible:ring-2 focus-visible:ring-status-ready focus-visible:ring-offset-1 focus-visible:ring-offset-kds-bg"
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
          ))}
          {data?.length === 0 && (
            <div className="w-[308px] flex flex-col items-center justify-center gap-3 py-14 px-6 text-kds-text-muted text-center">
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

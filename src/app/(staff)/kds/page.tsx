'use client';
import { useEffect } from 'react';
import Ably from 'ably';
import { trpc } from '@/lib/trpc-client';

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
    <main>
      <h1>Kitchen</h1>
      {data?.map((order) => (
        <section key={order.id}>
          <h2>{order.table?.label ?? order.type} — {order.status}</h2>
          {order.items.map((item) => (
            <div key={item.id}>
              {item.qty}x {item.menuItem.name} — {item.kitchenStatus}
              {item.kitchenStatus !== 'READY' && item.kitchenStatus !== 'SERVED' && (
                <>
                  <button onClick={() => updateStatus.mutate({ orderItemId: item.id, status: 'PREPARING' })}>Preparing</button>
                  <button onClick={() => updateStatus.mutate({ orderItemId: item.id, status: 'READY' })}>Ready</button>
                </>
              )}
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}

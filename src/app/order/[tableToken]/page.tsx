'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { trpc } from '@/lib/trpc-client';

// Explicit flat view of the field this page actually reads off the
// createByTable mutation's result. The real return type flows through
// Prisma's `order.create({ include: { items: true } })` payload, which
// hits TS2589 "Type instantiation is excessively deep and possibly
// infinite" when TypeScript checks the onSuccess callback against it
// (same class of error as the KDS page's order.listOpen consumption).
// Annotating the callback param and casting through it sidesteps the
// deep structural comparison without touching what's fetched/rendered.
type CreatedOrder = { id: string };

export default function CustomerOrderPage() {
  const { tableToken } = useParams<{ tableToken: string }>();
  const menu = trpc.menu.listAvailable.useQuery();
  const [cart, setCart] = useState<{ menuItemId: string; qty: number }[]>([]);
  const [orderId, setOrderId] = useState<string | null>(null);
  const openOrder = trpc.order.getOpenOrderByTableToken.useQuery({ tableToken });
  const createOrder = trpc.order.createByTable.useMutation({
    onSuccess: (order: unknown) => { setOrderId((order as CreatedOrder).id); setCart([]); },
  });
  const appendItems = trpc.order.appendItems.useMutation({ onSuccess: () => setCart([]) });

  // Recover an already-open tab on mount (e.g. after a page reload or
  // re-scanning the QR code) so a submission appends instead of creating
  // a duplicate order for the same table.
  useEffect(() => {
    if (!orderId && openOrder.data) {
      setOrderId(openOrder.data.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openOrder.data]);

  function addToCart(menuItemId: string) {
    setCart((c) => {
      const existing = c.find((i) => i.menuItemId === menuItemId);
      if (existing) return c.map((i) => (i.menuItemId === menuItemId ? { ...i, qty: i.qty + 1 } : i));
      return [...c, { menuItemId, qty: 1 }];
    });
  }

  function submit() {
    if (!cart.length) return;
    if (orderId) {
      appendItems.mutate({ orderId, tableToken, items: cart });
    } else {
      createOrder.mutate({ tableToken, items: cart });
    }
  }

  return (
    <main>
      <h1>Menu</h1>
      {menu.data?.map((item) => (
        <div key={item.id}>
          {item.name} — {String(item.price)}
          <button onClick={() => addToCart(item.id)}>Add</button>
        </div>
      ))}
      <button disabled={!cart.length} onClick={submit}>
        {orderId ? 'Add to Order' : 'Submit Order'}
      </button>
      {(createOrder.isSuccess || appendItems.isSuccess) && <p>Sent to kitchen!</p>}
      {orderId && <p>Your tab stays open — order more anytime, pay at the end.</p>}
    </main>
  );
}

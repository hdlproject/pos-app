'use client';
import { useState } from 'react';
import { trpc } from '@/lib/trpc-client';

type CartLine = { menuItemId: string; qty: number };

export default function PosPage() {
  const menu = trpc.menu.listAll.useQuery();
  const tables = trpc.table.list.useQuery();
  const [type, setType] = useState<'DINE_IN' | 'TAKEAWAY' | 'DELIVERY'>('TAKEAWAY');
  const [tableId, setTableId] = useState<string>('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const createOrder = trpc.order.createStaff.useMutation({ onSuccess: () => setCart([]) });

  function addToCart(menuItemId: string) {
    setCart((c) => {
      const existing = c.find((i) => i.menuItemId === menuItemId);
      if (existing) return c.map((i) => (i.menuItemId === menuItemId ? { ...i, qty: i.qty + 1 } : i));
      return [...c, { menuItemId, qty: 1 }];
    });
  }

  function submit() {
    createOrder.mutate({ type, tableId: type === 'DINE_IN' ? tableId || undefined : undefined, items: cart });
  }

  return (
    <main>
      <h1>New Order</h1>
      <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
        <option value="DINE_IN">Dine-in</option>
        <option value="TAKEAWAY">Takeaway</option>
        <option value="DELIVERY">Delivery</option>
      </select>
      {type === 'DINE_IN' && (
        <select value={tableId} onChange={(e) => setTableId(e.target.value)}>
          <option value="">Walk-in</option>
          {tables.data?.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
      )}

      <ul>
        {menu.data?.map((item) => (
          <li key={item.id}>
            {item.name} — {String(item.price)}
            <button onClick={() => addToCart(item.id)}>Add</button>
          </li>
        ))}
      </ul>

      <h2>Cart</h2>
      <ul>
        {cart.map((line) => {
          const item = menu.data?.find((m) => m.id === line.menuItemId);
          return <li key={line.menuItemId}>{item?.name} x{line.qty}</li>;
        })}
      </ul>

      <button disabled={!cart.length || createOrder.isPending} onClick={submit}>
        Send to Kitchen
      </button>
      {createOrder.isSuccess && <p>Order submitted.</p>}
    </main>
  );
}

'use client';
import { useState } from 'react';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';

type CartLine = { menuItemId: string; qty: number };

export default function PosPage() {
  const menu = trpc.menu.listAll.useQuery();
  const tables = trpc.table.list.useQuery();
  const [type, setType] = useState<'DINE_IN' | 'TAKEAWAY' | 'DELIVERY'>('TAKEAWAY');
  const [tableId, setTableId] = useState<string>('');
  const [category, setCategory] = useState<string>('All');
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

  const items = menu.data ?? [];
  const categories = ['All', ...Array.from(new Set(items.map((i) => i.category.name)))];
  const visibleItems = category === 'All' ? items : items.filter((i) => i.category.name === category);
  const cartTotal = cart.reduce((sum, line) => {
    const item = items.find((i) => i.id === line.menuItemId);
    return sum + (item ? Number(item.price) * line.qty : 0);
  }, 0);

  return (
    <div className="min-h-screen flex bg-bg">
      <main className="flex-1 min-w-0 flex flex-col p-6 overflow-y-auto">
        <h1 className="font-display text-2xl text-text mb-4">New Order</h1>

        <div className="flex gap-2.5 flex-wrap mb-5">
          {categories.map((c) => (
            <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
              {c}
            </Chip>
          ))}
        </div>

        <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
          {visibleItems.map((item) => (
            <Card key={item.id} className="flex flex-col gap-2.5">
              <div className="font-bold text-text text-sm">{item.name}</div>
              <div className="flex items-center justify-between gap-2">
                <div className="font-extrabold text-accent-tint text-sm">Rp {String(item.price)}</div>
                <Button variant="dark" size="sm" onClick={() => addToCart(item.id)}>
                  + Add
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </main>

      <aside className="w-[360px] shrink-0 bg-surface border-l border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <div className="flex gap-1.5 bg-bg p-1 rounded-xl">
            {(['DINE_IN', 'TAKEAWAY', 'DELIVERY'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`flex-1 py-2.5 rounded-lg font-extrabold text-xs ${
                  type === t ? 'bg-surface text-accent shadow-sm' : 'text-text-muted-2'
                }`}
              >
                {t === 'DINE_IN' ? 'Dine-in' : t === 'TAKEAWAY' ? 'Takeaway' : 'Delivery'}
              </button>
            ))}
          </div>
          {type === 'DINE_IN' && (
            <select
              value={tableId}
              onChange={(e) => setTableId(e.target.value)}
              className="w-full mt-3 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm font-semibold text-text outline-none"
            >
              <option value="">Walk-in</option>
              {tables.data?.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-8 py-10 text-text-muted">
              <div className="w-12 h-12 rounded-2xl bg-surface-input flex items-center justify-center text-xl">🧺</div>
              <div className="font-bold text-text-muted-2">No items yet</div>
              <div className="text-xs">Tap a menu item to start building the order.</div>
            </div>
          ) : (
            cart.map((line) => {
              const item = items.find((m) => m.id === line.menuItemId);
              return (
                <div key={line.menuItemId} className="flex justify-between items-start px-2 py-2.5 border-b border-border">
                  <div>
                    <div className="font-bold text-sm text-text">{item?.name}</div>
                    <div className="text-xs text-text-muted">Rp {item ? String(item.price) : ''} each</div>
                  </div>
                  <div className="font-extrabold text-sm text-text">×{line.qty}</div>
                </div>
              );
            })
          )}
        </div>

        <div className="border-t border-border p-4">
          <div className="flex justify-between items-baseline pb-2.5 mb-1">
            <span className="font-extrabold text-text">Total</span>
            <span className="font-extrabold text-xl text-accent">Rp {cartTotal.toLocaleString('id-ID')}</span>
          </div>
          <Button
            variant="primary"
            className="w-full mt-2"
            disabled={!cart.length || createOrder.isPending}
            onClick={submit}
          >
            Send to Kitchen
          </Button>
          {createOrder.isSuccess && (
            <p className="text-success text-xs font-semibold mt-2 text-center">Order submitted.</p>
          )}
        </div>
      </aside>
    </div>
  );
}

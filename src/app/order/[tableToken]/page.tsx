'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { MenuItemThumbnail } from '@/components/ui/MenuItemThumbnail';
import { SwipeToRemove } from '@/components/ui/SwipeToRemove';

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
  const [category, setCategory] = useState<string>('All');
  const [cartOpen, setCartOpen] = useState(false);
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

  // Cart-in-progress (items added but not yet submitted) survives a
  // refresh too, keyed per table so two tables' QR sessions on the same
  // device never mix. Restore runs once before the persist effect starts
  // writing, same reasoning as the staff POS page's cart persistence.
  const cartHydrated = useRef(false);
  useEffect(() => {
    if (cartHydrated.current) return;
    const saved = localStorage.getItem(`order-cart-${tableToken}`);
    if (saved) {
      try { setCart(JSON.parse(saved)); } catch { /* ignore corrupt value */ }
    }
    cartHydrated.current = true;
  }, [tableToken]);

  useEffect(() => {
    if (!cartHydrated.current) return;
    localStorage.setItem(`order-cart-${tableToken}`, JSON.stringify(cart));
  }, [cart, tableToken]);

  function addToCart(menuItemId: string) {
    setCart((c) => {
      const existing = c.find((i) => i.menuItemId === menuItemId);
      if (existing) return c.map((i) => (i.menuItemId === menuItemId ? { ...i, qty: i.qty + 1 } : i));
      return [...c, { menuItemId, qty: 1 }];
    });
  }

  function removeFromCart(menuItemId: string) {
    setCart((c) => c.filter((i) => i.menuItemId !== menuItemId));
  }

  function submit() {
    if (!cart.length) return;
    if (orderId) {
      appendItems.mutate({ orderId, tableToken, items: cart });
    } else {
      createOrder.mutate({ tableToken, items: cart });
    }
  }

  const items = menu.data ?? [];
  const categories = ['All', ...Array.from(new Set(items.map((i) => i.category.name)))];
  const visibleItems = category === 'All' ? items : items.filter((i) => i.category.name === category);
  const cartCount = cart.reduce((sum, l) => sum + l.qty, 0);

  return (
    <div className="min-h-screen flex items-start justify-center p-0 sm:p-4 bg-[radial-gradient(120%_60%_at_50%_0%,#e7dccb,#d3c6b3)]">
      <div className="relative w-full max-w-[412px] bg-surface flex flex-col h-dvh overflow-hidden sm:h-[844px] sm:max-h-[calc(100dvh-32px)] sm:rounded-[34px] sm:shadow-2xl">
        <div className="flex-1 overflow-y-auto">
          <div className="px-5 pt-5 pb-6 bg-gradient-to-br from-accent to-accent-hover text-white">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center font-display text-2xl">K</div>
              <div>
                <div className="font-display text-lg leading-tight">Kopi &amp; Co</div>
                <div className="text-[11px] font-bold opacity-85">Self-order</div>
              </div>
            </div>
          </div>

          <div className="sticky top-0 z-10 bg-surface py-3">
            <div className="flex gap-2 overflow-x-auto px-4">
              {categories.map((c) => (
                <Chip key={c} active={category === c} onClick={() => setCategory(c)} className="shrink-0">
                  {c}
                </Chip>
              ))}
            </div>
          </div>

          <div className="px-4 pb-24 pt-1.5 flex flex-col gap-3">
            {visibleItems.map((item) => (
              <div key={item.id} className="flex gap-3 bg-surface border border-border rounded-2xl p-3">
                <MenuItemThumbnail
                  image={item.image}
                  categoryName={item.category.name}
                  alt={item.name}
                  className="w-16 h-16 rounded-xl shrink-0"
                />
                <div className="flex-1 min-w-0 flex flex-col">
                  <span className="font-extrabold text-sm text-text">{item.name}</span>
                  <div className="flex items-center justify-between mt-auto pt-2">
                    <span className="font-extrabold text-sm text-accent-tint">Rp {Number(item.price).toLocaleString('id-ID')}</span>
                    <Button variant="dark" size="sm" onClick={() => addToCart(item.id)}>
                      Add
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {cartCount > 0 && (
          <div className="absolute left-0 right-0 bottom-0 p-4 bg-gradient-to-t from-surface via-surface/95 to-transparent">
            {cartOpen && (
              <div className="bg-dark-ui rounded-2xl p-2 mb-2 shadow-lg flex flex-col gap-1 max-h-48 overflow-y-auto">
                {cart.map((line) => {
                  const item = items.find((m) => m.id === line.menuItemId);
                  return (
                    <SwipeToRemove
                      key={line.menuItemId}
                      onRemove={() => removeFromCart(line.menuItemId)}
                      rowClassName="bg-dark-ui"
                    >
                      <div className="px-2 py-1.5 text-white text-xs">
                        <span className="font-bold">×{line.qty}</span> {item?.name}
                      </div>
                    </SwipeToRemove>
                  );
                })}
              </div>
            )}
            <div className="bg-dark-ui rounded-2xl p-1.5 flex items-center gap-2.5 shadow-lg">
              <button
                onClick={() => setCartOpen((o) => !o)}
                className="flex items-center gap-3 py-2 pl-3 flex-1 text-left"
              >
                <span className="w-8 h-8 rounded-lg bg-accent text-white flex items-center justify-center text-sm font-extrabold">
                  {cartCount}
                </span>
                <div className="text-white text-sm font-bold">{orderId ? 'Add to open tab' : 'Start order'}</div>
              </button>
              <Button variant="primary" onClick={submit} disabled={!cart.length}>
                {orderId ? 'Add' : 'Submit'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {(createOrder.isSuccess || appendItems.isSuccess) && (
        <p className="fixed bottom-4 left-1/2 -translate-x-1/2 text-sm font-bold text-success bg-white px-4 py-2 rounded-full shadow z-50">
          Sent to kitchen!
        </p>
      )}
      {orderId && (
        <p className="fixed top-4 left-1/2 -translate-x-1/2 text-xs font-semibold text-text-muted bg-white/90 px-3 py-1.5 rounded-full shadow z-50">
          Your tab stays open — order more anytime, pay at the end.
        </p>
      )}
    </div>
  );
}

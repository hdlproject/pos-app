'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { PageHeader } from '@/components/ui/PageHeader';
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
    setCartOpen(true);
  }

  function removeFromCart(menuItemId: string) {
    setCart((c) => c.filter((i) => i.menuItemId !== menuItemId));
  }

  function changeQty(menuItemId: string, delta: number) {
    setCart((c) => {
      const line = c.find((i) => i.menuItemId === menuItemId);
      if (!line) return c;
      const qty = line.qty + delta;
      if (qty <= 0) return c.filter((i) => i.menuItemId !== menuItemId);
      return c.map((i) => (i.menuItemId === menuItemId ? { ...i, qty } : i));
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

  const items = menu.data ?? [];
  const categories = ['All', ...Array.from(new Set(items.map((i) => i.category.name)))];
  const visibleItems = category === 'All' ? items : items.filter((i) => i.category.name === category);
  const cartTotal = cart.reduce((sum, line) => {
    const item = items.find((i) => i.id === line.menuItemId);
    return sum + (item ? Number(item.price) * line.qty : 0);
  }, 0);
  const cartCount = cart.reduce((sum, l) => sum + l.qty, 0);

  return (
    <div className="min-h-screen md:h-screen overflow-y-auto md:overflow-hidden flex flex-col bg-bg">
      <PageHeader
        title="Kopi & Co"
        subtitle="Self-order"
        right={
          <>
            {orderId && (
              <span className="text-[11px] font-bold text-text-muted-2 bg-surface-input px-3 py-1.5 rounded-full">
                Tab open — pay at the end
              </span>
            )}
            <Link
              href="/"
              className="text-xs font-bold text-text-muted-2 px-3 py-2 rounded-lg hover:bg-surface-input transition-colors"
            >
              Home
            </Link>
          </>
        }
      />
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        <main className="flex-1 min-w-0 flex flex-col p-6 overflow-y-auto">
          <h1 className="font-display text-2xl text-text mb-4">Menu</h1>

          <div className="flex gap-2.5 flex-wrap mb-5">
            {categories.map((c) => (
              <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
                {c}
              </Chip>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2.5 md:gap-3.5 md:grid-cols-[repeat(auto-fill,minmax(190px,1fr))]">
            {visibleItems.map((item) => (
              <Card key={item.id} className="flex flex-col gap-2.5">
                <MenuItemThumbnail
                  image={item.image}
                  categoryName={item.category.name}
                  alt={item.name}
                  className="w-full h-20 rounded-xl"
                />
                <div className="font-bold text-text text-sm">{item.name}</div>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-extrabold text-accent-tint text-sm">Rp {Number(item.price).toLocaleString('id-ID')}</div>
                  <Button variant="dark" size="sm" onClick={() => addToCart(item.id)}>
                    + Add
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </main>

        {cartOpen && (
          <div
            onClick={() => setCartOpen(false)}
            className="fixed inset-0 z-10 bg-black/40 md:hidden"
          />
        )}

        {!cartOpen && cartCount > 0 && (
          <button
            onClick={() => setCartOpen(true)}
            className="fixed bottom-4 right-4 z-30 md:hidden flex items-center gap-2 bg-dark-ui text-white font-extrabold text-sm pl-2 pr-4 py-2 rounded-full shadow-2xl"
          >
            <span className="w-7 h-7 rounded-full bg-accent flex items-center justify-center text-xs">{cartCount}</span>
            View cart
          </button>
        )}

        <aside
          className={`fixed inset-y-0 right-0 z-20 w-[85vw] max-w-[360px] shadow-2xl transition-transform duration-300 ease-out ${
            cartOpen ? 'translate-x-0' : 'translate-x-full'
          } md:static md:inset-auto md:z-auto md:w-[360px] md:max-w-none md:shadow-none md:translate-x-0 md:shrink-0 bg-surface border-l border-border flex flex-col`}
        >
          <div className="p-4 border-b border-border flex items-center justify-between md:block">
            <span className="font-extrabold text-text text-sm">Your order</span>
            <button
              onClick={() => setCartOpen(false)}
              aria-label="Close cart"
              className="p-1.5 rounded-lg bg-surface-input text-text-muted-2 md:hidden"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-8 py-10 text-text-muted">
                <div className="w-12 h-12 rounded-2xl bg-surface-input flex items-center justify-center text-xl">🧺</div>
                <div className="font-bold text-text-muted-2">No items yet</div>
                <div className="text-xs">Tap a menu item to start your order.</div>
              </div>
            ) : (
              cart.map((line) => {
                const item = items.find((m) => m.id === line.menuItemId);
                return (
                  <div key={line.menuItemId} className="border-b border-border">
                    <SwipeToRemove onRemove={() => removeFromCart(line.menuItemId)}>
                      <div className="flex items-center gap-2.5 px-2 py-2.5">
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-sm text-text truncate">{item?.name}</div>
                          <div className="text-xs text-text-muted">Rp {item ? Number(item.price).toLocaleString('id-ID') : ''} each</div>
                        </div>
                        <div
                          className="flex items-center gap-2 bg-surface-input rounded-lg p-0.5 shrink-0"
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => changeQty(line.menuItemId, -1)}
                            aria-label={`Decrease ${item?.name ?? 'item'} quantity`}
                            className="w-6 h-6 rounded-md bg-surface text-accent-tint font-extrabold text-sm flex items-center justify-center shadow-sm"
                          >
                            −
                          </button>
                          <div className="font-extrabold text-xs text-text w-4 text-center">{line.qty}</div>
                          <button
                            onClick={() => changeQty(line.menuItemId, 1)}
                            aria-label={`Increase ${item?.name ?? 'item'} quantity`}
                            className="w-6 h-6 rounded-md bg-surface text-accent-tint font-extrabold text-sm flex items-center justify-center shadow-sm"
                          >
                            +
                          </button>
                        </div>
                        <div className="w-16 shrink-0 text-right font-extrabold text-sm text-text">
                          Rp {item ? (Number(item.price) * line.qty).toLocaleString('id-ID') : ''}
                        </div>
                      </div>
                    </SwipeToRemove>
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
              disabled={!cart.length || createOrder.isPending || appendItems.isPending}
              onClick={submit}
            >
              {orderId ? 'Add to tab' : 'Submit order'}
            </Button>
            {(createOrder.isSuccess || appendItems.isSuccess) && (
              <p className="text-success text-xs font-semibold mt-2 text-center">Sent to kitchen!</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

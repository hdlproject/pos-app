'use client';
import { useEffect, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { PageHeader } from '@/components/ui/PageHeader';
import { LogoutButton } from '@/components/ui/LogoutButton';
import { MenuItemThumbnail } from '@/components/ui/MenuItemThumbnail';
import { Select } from '@/components/ui/Select';
import { SwipeToRemove } from '@/components/ui/SwipeToRemove';

type OrderType = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
type CartLine = { menuItemId: string; qty: number };
type Carts = Record<OrderType, CartLine[]>;

const EMPTY_CARTS: Carts = { DINE_IN: [], TAKEAWAY: [], DELIVERY: [] };

export default function PosPage() {
  const me = trpc.auth.me.useQuery();
  const menu = trpc.menu.listAll.useQuery();
  const tables = trpc.table.list.useQuery();
  const [type, setType] = useState<OrderType>('TAKEAWAY');
  const [tableId, setTableId] = useState<string>('');
  const [category, setCategory] = useState<string>('All');
  // Each order type keeps its own cart -- switching Dine-in/Takeaway/Delivery
  // swaps which one is visible instead of sharing a single list, so an item
  // added under one type never bleeds into another.
  const [carts, setCarts] = useState<Carts>(EMPTY_CARTS);
  const cart = carts[type];
  const createOrder = trpc.order.createStaff.useMutation({
    onSuccess: (_data, variables) => setCarts((c) => ({ ...c, [variables.type]: [] })),
  });

  // Remember the last-selected category per logged-in user (not globally)
  // so a shared POS terminal doesn't leak one staff member's last category
  // to the next person who logs in on the same device.
  useEffect(() => {
    if (!me.data) return;
    const saved = localStorage.getItem(`pos-category-${me.data.userId}`);
    if (saved) setCategory(saved);
  }, [me.data]);

  function selectCategory(c: string) {
    setCategory(c);
    if (me.data) localStorage.setItem(`pos-category-${me.data.userId}`, c);
  }

  // In-progress order survives a refresh, per logged-in user (a shared
  // terminal shouldn't leak one staff member's cart to the next). Restore
  // must finish before the persist effect starts, or the persist effect's
  // first run (still holding the pre-restore empty cart) would immediately
  // overwrite the saved value.
  const cartHydrated = useRef(false);
  useEffect(() => {
    if (!me.data || cartHydrated.current) return;
    const saved = localStorage.getItem(`pos-cart-${me.data.userId}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Older saved carts were a single flat array (pre-per-type split);
        // treat that as a Takeaway cart, the previous default type.
        setCarts(Array.isArray(parsed) ? { ...EMPTY_CARTS, TAKEAWAY: parsed } : { ...EMPTY_CARTS, ...parsed });
      } catch { /* ignore corrupt value */ }
    }
    cartHydrated.current = true;
  }, [me.data]);

  useEffect(() => {
    if (!me.data || !cartHydrated.current) return;
    localStorage.setItem(`pos-cart-${me.data.userId}`, JSON.stringify(carts));
  }, [carts, me.data]);

  function addToCart(menuItemId: string) {
    setCarts((all) => {
      const c = all[type];
      const existing = c.find((i) => i.menuItemId === menuItemId);
      const updated = existing
        ? c.map((i) => (i.menuItemId === menuItemId ? { ...i, qty: i.qty + 1 } : i))
        : [...c, { menuItemId, qty: 1 }];
      return { ...all, [type]: updated };
    });
  }

  function removeFromCart(menuItemId: string) {
    setCarts((all) => ({ ...all, [type]: all[type].filter((i) => i.menuItemId !== menuItemId) }));
  }

  function changeQty(menuItemId: string, delta: number) {
    setCarts((all) => {
      const c = all[type];
      const line = c.find((i) => i.menuItemId === menuItemId);
      if (!line) return all;
      const qty = line.qty + delta;
      const updated = qty <= 0
        ? c.filter((i) => i.menuItemId !== menuItemId)
        : c.map((i) => (i.menuItemId === menuItemId ? { ...i, qty } : i));
      return { ...all, [type]: updated };
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
    <div className="min-h-screen md:h-screen overflow-y-auto md:overflow-hidden flex flex-col bg-bg">
      <PageHeader
        title="Point of Sale"
        right={
          <div
            onClickCapture={(e) => {
              const hasAnyCart = Object.values(carts).some((c) => c.length > 0);
              if (hasAnyCart && !window.confirm('You have an in-progress order. Log out anyway?')) {
                e.stopPropagation();
              }
            }}
          >
            <LogoutButton />
          </div>
        }
      />
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        <main className="flex-1 min-w-0 flex flex-col p-6 overflow-y-auto">
          <h1 className="font-display text-2xl text-text mb-4">New Order</h1>

          <div className="flex gap-2.5 flex-wrap mb-5">
            {categories.map((c) => (
              <Chip key={c} active={category === c} onClick={() => selectCategory(c)}>
                {c}
              </Chip>
            ))}
          </div>

          <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
            {visibleItems.map((item) => {
              const effectivelyAvailable = item.available && !item.outOfStockReason;
              return (
                <Card key={item.id} className={`flex flex-col gap-2.5 ${effectivelyAvailable ? '' : 'opacity-50'}`}>
                  <MenuItemThumbnail
                    image={item.image}
                    categoryName={item.category.name}
                    alt={item.name}
                    className="w-full h-20 rounded-xl"
                  />
                  <div className="font-bold text-text text-sm">{item.name}</div>
                  <div className="flex items-center justify-between gap-2">
                    {effectivelyAvailable ? (
                      <div className="font-extrabold text-accent-tint text-sm">Rp {Number(item.price).toLocaleString('id-ID')}</div>
                    ) : (
                      <div className="text-warning text-xs font-semibold">{item.outOfStockReason ?? 'Sold out'}</div>
                    )}
                    <Button variant="dark" size="sm" disabled={!effectivelyAvailable} onClick={() => addToCart(item.id)}>
                      + Add
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </main>

        <aside className="w-full h-[70vh] md:h-auto md:w-[360px] md:shrink-0 bg-surface border-t md:border-t-0 md:border-l border-border flex flex-col">
          <div className="p-4 border-b border-border">
            <div className="flex gap-1.5 bg-bg p-1 rounded-xl">
              {(['DINE_IN', 'TAKEAWAY', 'DELIVERY'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`flex-1 py-2.5 rounded-lg font-extrabold text-xs focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 ${
                    type === t ? 'bg-surface text-accent shadow-sm' : 'text-text-muted-2'
                  }`}
                >
                  {t === 'DINE_IN' ? 'Dine-in' : t === 'TAKEAWAY' ? 'Takeaway' : 'Delivery'}
                </button>
              ))}
            </div>
            {type === 'DINE_IN' && (
              <Select
                value={tableId}
                onChange={setTableId}
                options={[{ value: '', label: 'Walk-in' }, ...(tables.data?.map((t) => ({ value: t.id, label: t.label })) ?? [])]}
                className="w-full mt-3 px-3 py-2 font-semibold"
              />
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
                  <div key={line.menuItemId} className="border-b border-border">
                    <SwipeToRemove onRemove={() => removeFromCart(line.menuItemId)}>
                      <div className="flex justify-between items-start px-2 py-2.5">
                        <div>
                          <div className="font-bold text-sm text-text">{item?.name}</div>
                          <div className="text-xs text-text-muted">Rp {item ? Number(item.price).toLocaleString('id-ID') : ''} each</div>
                        </div>
                        <div className="flex items-center gap-1.5" onPointerDown={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => changeQty(line.menuItemId, -1)}
                            aria-label={`Decrease ${item?.name ?? 'item'} quantity`}
                            className="w-6 h-6 rounded-lg bg-surface-input text-text-muted-2 font-extrabold text-sm flex items-center justify-center hover:bg-border"
                          >
                            −
                          </button>
                          <div className="font-extrabold text-sm text-text w-4 text-center">{line.qty}</div>
                          <button
                            onClick={() => changeQty(line.menuItemId, 1)}
                            aria-label={`Increase ${item?.name ?? 'item'} quantity`}
                            className="w-6 h-6 rounded-lg bg-surface-input text-text-muted-2 font-extrabold text-sm flex items-center justify-center hover:bg-border"
                          >
                            +
                          </button>
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
    </div>
  );
}

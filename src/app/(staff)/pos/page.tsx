'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
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
// Matches the KDS/order pages' TS2589 workaround: an explicit flat view of
// what these calls actually need, instead of the full inferred Prisma shape.
type CreatedOrder = { id: string };

const EMPTY_CARTS: Carts = { DINE_IN: [], TAKEAWAY: [], DELIVERY: [] };
const QUICK_CASH = [50000, 100000, 150000, 200000];

export default function PosPage() {
  const me = trpc.auth.me.useQuery();
  const menu = trpc.menu.listAll.useQuery();
  const tables = trpc.table.list.useQuery();
  const pending = trpc.order.listPendingDispatch.useQuery();
  const pendingCount = pending.data?.length ?? 0;
  const [type, setType] = useState<OrderType>('TAKEAWAY');
  const [tableId, setTableId] = useState<string>('');
  const [category, setCategory] = useState<string>('All');
  // Each order type keeps its own cart -- switching Dine-in/Takeaway/Delivery
  // swaps which one is visible instead of sharing a single list, so an item
  // added under one type never bleeds into another.
  const [carts, setCarts] = useState<Carts>(EMPTY_CARTS);
  const cart = carts[type];
  // Mobile-only: the cart panel overlays the item list rather than sitting
  // beside it, so it opens automatically when an item is added and can be
  // reopened via the floating button once dismissed. No-op on desktop,
  // where the panel is always visible in its own column.
  const [cartOpen, setCartOpen] = useState(false);
  // Explicit param types sidestep TS2589 "Type instantiation is excessively
  // deep" -- the mutation's full input/output inference (order + items +
  // the new optional `pending` flag) pushes past the compiler's recursion
  // limit here, same class of error as the KDS/order pages' workarounds.
  // Charge Cash is the only path to the kitchen now -- an order is created
  // as pending (OPEN) and only reaches SENT_TO_KITCHEN once it's paid and
  // confirmed from the Pending Purchases list.
  const createPending = trpc.order.createStaff.useMutation({
    onSuccess: (_data: unknown, variables: { type: OrderType }) => setCarts((c) => ({ ...c, [variables.type]: [] })),
  });
  const payCash = trpc.payment.payCash.useMutation();
  const [paymentOrder, setPaymentOrder] = useState<{ id: string; total: number } | null>(null);
  const [tendered, setTendered] = useState('');
  const [change, setChange] = useState<number | null>(null);

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
    setCartOpen(true);
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

  function clearCart() {
    setCarts((all) => ({ ...all, [type]: [] }));
  }

  // Charge Cash creates the order as OPEN (paid before dispatch) instead of
  // sending it to the kitchen -- confirming payment below opens the modal;
  // the order only reaches the kitchen once someone dispatches it from the
  // pending-purchases list.
  async function chargeCash() {
    if (!cart.length) return;
    const order = (await createPending.mutateAsync({
      type,
      tableId: type === 'DINE_IN' ? tableId || undefined : undefined,
      items: cart,
      pending: true,
    })) as CreatedOrder;
    setPaymentOrder({ id: order.id, total: cartTotal });
    setTendered('');
    setChange(null);
  }

  function confirmPayment() {
    if (!paymentOrder) return;
    const amount = Number(tendered) || 0;
    payCash.mutate(
      { orderId: paymentOrder.id, tendered: amount },
      { onSuccess: (result) => { setChange(result.change); pending.refetch(); } }
    );
  }

  function closePaymentModal() {
    setPaymentOrder(null);
    setTendered('');
    setChange(null);
    payCash.reset();
  }

  const items = menu.data ?? [];
  const categories = ['All', ...Array.from(new Set(items.map((i) => i.category.name)))];
  const visibleItems = category === 'All' ? items : items.filter((i) => i.category.name === category);
  const cartTotal = cart.reduce((sum, line) => {
    const item = items.find((i) => i.id === line.menuItemId);
    return sum + (item ? Number(item.price) * line.qty : 0);
  }, 0);
  const cartCount = cart.reduce((sum, line) => sum + line.qty, 0);

  return (
    <div className="min-h-screen md:h-screen overflow-y-auto md:overflow-hidden flex flex-col bg-bg">
      <PageHeader
        title="Point of Sale"
        right={
          <>
            <Link
              href="/pending"
              className={`flex items-center gap-2 pl-3.5 pr-3 py-2 rounded-xl font-extrabold text-sm transition-colors ${
                pendingCount > 0
                  ? 'bg-warning/10 text-warning border border-warning/30 hover:bg-warning/15'
                  : 'text-text-muted-2 hover:bg-surface-input'
              }`}
            >
              Pending
              {pendingCount > 0 && (
                <span className="w-5 h-5 rounded-full bg-warning text-white text-[11px] font-extrabold flex items-center justify-center animate-pulse">
                  {pendingCount}
                </span>
              )}
            </Link>
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
          </>
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

          <div className="grid grid-cols-3 gap-2.5 md:gap-3.5 md:grid-cols-[repeat(auto-fill,minmax(190px,1fr))]">
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
          <div className="p-4 border-b border-border">
            <div className="flex items-center justify-between gap-2 mb-3 md:hidden">
              <span className="font-extrabold text-text text-sm">Cart</span>
              <button
                onClick={() => setCartOpen(false)}
                aria-label="Close cart"
                className="p-1.5 rounded-lg bg-surface-input text-text-muted-2"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
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
            <div className="flex gap-2.5 mt-2">
              <Button
                variant="outline"
                className="shrink-0"
                disabled={!cart.length}
                onClick={clearCart}
              >
                Clear
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                disabled={!cart.length || createPending.isPending}
                onClick={chargeCash}
              >
                Charge · Cash
              </Button>
            </div>
          </div>
        </aside>
      </div>

      {paymentOrder && (
        <div className="fixed inset-0 z-50 bg-dark-ui/60 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-[420px] bg-surface rounded-3xl overflow-hidden shadow-2xl">
            {change === null ? (
              <div>
                <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-border">
                  <div>
                    <div className="font-display text-xl text-text">Cash Payment</div>
                    <div className="text-xs text-text-muted font-semibold mt-0.5">
                      {type === 'DINE_IN' ? 'Dine-in' : type === 'TAKEAWAY' ? 'Takeaway' : 'Delivery'} · {cart.reduce((s, l) => s + l.qty, 0)} items
                    </div>
                  </div>
                  <button
                    onClick={closePaymentModal}
                    aria-label="Close"
                    className="w-8 h-8 rounded-lg bg-surface-input text-accent-tint flex items-center justify-center shrink-0"
                  >
                    ✕
                  </button>
                </div>
                <div className="p-5">
                  <div className="flex justify-between items-baseline px-4 py-3.5 bg-surface-input rounded-2xl mb-4">
                    <span className="text-sm font-bold text-accent-tint">Amount due</span>
                    <span className="text-2xl font-extrabold text-accent">Rp {paymentOrder.total.toLocaleString('id-ID')}</span>
                  </div>

                  <label className="text-xs font-bold text-text-muted uppercase tracking-wide">Amount tendered</label>
                  <div className="relative mt-1.5">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-extrabold text-text-muted">Rp</span>
                    <input
                      value={tendered}
                      onChange={(e) => setTendered(e.target.value.replace(/[^0-9]/g, ''))}
                      inputMode="numeric"
                      placeholder="0"
                      className="w-full pl-11 pr-4 py-3.5 border border-border-strong rounded-2xl bg-surface-input font-extrabold text-lg text-text outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2 mt-3">
                    {QUICK_CASH.map((v) => (
                      <button
                        key={v}
                        onClick={() => setTendered(String(v))}
                        className="flex-1 min-w-[calc(33%-6px)] py-2.5 px-2 border border-border-strong rounded-xl bg-surface font-bold text-xs text-text-muted"
                      >
                        Rp {v.toLocaleString('id-ID')}
                      </button>
                    ))}
                  </div>

                  <div className="flex justify-between items-baseline mt-4 pt-3.5 border-t border-dashed border-border-strong">
                    <span className="font-extrabold text-text">Change</span>
                    <span
                      className={`text-xl font-extrabold ${
                        Number(tendered) >= paymentOrder.total ? 'text-success' : 'text-warning'
                      }`}
                    >
                      {Number(tendered) > 0
                        ? Number(tendered) >= paymentOrder.total
                          ? `Rp ${(Number(tendered) - paymentOrder.total).toLocaleString('id-ID')}`
                          : `— short Rp ${(paymentOrder.total - Number(tendered)).toLocaleString('id-ID')}`
                        : 'Rp 0'}
                    </span>
                  </div>

                  <Button
                    variant="success"
                    className="w-full mt-5"
                    disabled={Number(tendered) < paymentOrder.total || payCash.isPending}
                    onClick={confirmPayment}
                  >
                    Confirm payment
                  </Button>
                  {payCash.isError && (
                    <p className="text-warning text-xs font-semibold mt-2 text-center">{payCash.error.message}</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="px-8 py-10 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-success/15 flex items-center justify-center text-3xl text-success">
                  ✓
                </div>
                <div className="font-display text-xl text-text mb-1.5">Payment received</div>
                <div className="text-sm text-text-muted font-semibold leading-relaxed">
                  Added to Pending Purchases — confirm it there to send to the kitchen.
                  <br />
                  Change due: <span className="text-accent font-extrabold">Rp {change.toLocaleString('id-ID')}</span>
                </div>
                <Button variant="primary" className="w-full mt-5" onClick={closePaymentModal}>
                  New order
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

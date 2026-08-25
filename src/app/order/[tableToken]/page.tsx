'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { useParams, useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { PageHeader } from '@/components/ui/PageHeader';
import { MenuItemThumbnail } from '@/components/ui/MenuItemThumbnail';
import { SwipeToRemove } from '@/components/ui/SwipeToRemove';

// Explicit flat views of what this page actually reads off these calls.
// The real return types flow through Prisma's nested include payloads,
// which hit TS2589 "Type instantiation is excessively deep and possibly
// infinite" when TypeScript checks them structurally (same class of
// error as the KDS page's order.listOpen consumption). Annotating params
// and casting through these sidesteps the deep comparison without
// touching what's fetched/rendered.
type CreatedOrder = { id: string };
type SessionRound = {
  id: string;
  total: string;
  createdAt: string;
  items: { id: string; qty: number; menuItem: { name: string } }[];
};
type Recovery = { mode: 'OPEN_TABLE'; session: { id: string; sessionFinished: boolean; children: SessionRound[] } } | null;

export default function CustomerOrderPage() {
  const { tableToken } = useParams<{ tableToken: string }>();
  const router = useRouter();
  const menu = trpc.menu.listAvailable.useQuery();
  const [cart, setCart] = useState<{ menuItemId: string; qty: number }[]>([]);
  const [category, setCategory] = useState<string>('All');
  const [cartOpen, setCartOpen] = useState(false);

  // Open Table: one running tab, every submission is its own child order
  // sent straight to the kitchen (no per-round payment); the customer
  // settles up once, on the whole tab, when they finish. Ordinary: a
  // single order, staff confirms payment before it's dispatched -- the
  // flow this page already had. Nothing renders until one is chosen (or
  // recovered from an in-progress order/session for this table).
  const [mode, setMode] = useState<'ORDINARY' | 'OPEN_TABLE' | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionFinished, setSessionFinished] = useState(false);

  const openOrder = trpc.order.getOpenOrderByTableToken.useQuery({ tableToken });
  const startSession = trpc.order.startTableSession.useMutation();
  const finishSession = trpc.order.finishTableSession.useMutation();
  const createOrder = trpc.order.createByTable.useMutation({ onSuccess: () => setCart([]) });
  // Refetch after each round so "My Order" reflects it immediately --
  // getOpenOrderByTableToken is the only source for the round list.
  const createRound = trpc.order.createByTable.useMutation({
    onSuccess: () => { setCart([]); openOrder.refetch(); },
  });
  // Ordering doesn't charge anything here -- a staff member confirms
  // payment (collected in person) before it reaches the kitchen. Review
  // opens the summary modal only; nothing is submitted until Confirm.
  const [reviewOpen, setReviewOpen] = useState(false);
  const [placed, setPlaced] = useState(false);
  // Finishing the table is also a one-shot from the customer's side --
  // same success-then-redirect treatment as placing a one-time order,
  // instead of a dead-end full-screen page.
  const [finishedOpen, setFinishedOpen] = useState(false);
  // Rounds already submitted this session -- so a customer mid-tab can
  // check what they've ordered so far, not just what's currently in cart.
  const [orderSummaryOpen, setOrderSummaryOpen] = useState(false);

  // A one-time order is done the moment it's placed -- no more menu
  // browsing after, straight back to login. An Open Table round just
  // closes its own modal, since the tab stays open for more rounds.
  useEffect(() => {
    if (!placed) return;
    const timer = setTimeout(() => {
      if (mode === 'ORDINARY') {
        router.push('/login');
        return;
      }
      setReviewOpen(false);
      setPlaced(false);
    }, 1400);
    return () => clearTimeout(timer);
  }, [placed, mode, router]);

  useEffect(() => {
    if (!finishedOpen) return;
    const timer = setTimeout(() => router.push('/login'), 1400);
    return () => clearTimeout(timer);
  }, [finishedOpen, router]);

  // Recover an already-open tab/session on mount (e.g. after a page reload
  // or re-scanning the QR code) instead of re-showing the mode choice.
  useEffect(() => {
    if (mode || !openOrder.data) return;
    const recovered = openOrder.data as unknown as Recovery;
    if (recovered?.mode === 'OPEN_TABLE') {
      setMode('OPEN_TABLE');
      setSessionId(recovered.session.id);
      setSessionFinished(recovered.session.sessionFinished);
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

  function chooseOpenTable() {
    startSession.mutate(
      { tableToken },
      {
        onSuccess: (order: unknown) => {
          setMode('OPEN_TABLE');
          setSessionId((order as CreatedOrder).id);
          setSessionFinished(false);
          openOrder.refetch();
        },
      }
    );
  }

  function finishTable() {
    if (!sessionId) return;
    finishSession.mutate(
      { tableToken, orderId: sessionId },
      { onSuccess: () => { setSessionFinished(true); setFinishedOpen(true); } }
    );
  }

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

  function openReview() {
    if (!cart.length) return;
    setPlaced(false);
    setReviewOpen(true);
  }

  function confirmOrder() {
    if (!cart.length) return;
    if (mode === 'OPEN_TABLE' && sessionId) {
      createRound.mutate({ tableToken, items: cart, parentOrderId: sessionId }, { onSuccess: () => setPlaced(true) });
    } else {
      createOrder.mutate({ tableToken, items: cart }, { onSuccess: () => setPlaced(true) });
    }
  }

  function closeReview() {
    setReviewOpen(false);
    setPlaced(false);
    createOrder.reset();
    createRound.reset();
  }

  const items = menu.data ?? [];
  const categories = ['All', ...Array.from(new Set(items.map((i) => i.category.name)))];
  const visibleItems = category === 'All' ? items : items.filter((i) => i.category.name === category);
  const cartTotal = cart.reduce((sum, line) => {
    const item = items.find((i) => i.id === line.menuItemId);
    return sum + (item ? Number(item.price) * line.qty : 0);
  }, 0);
  const cartCount = cart.reduce((sum, l) => sum + l.qty, 0);
  const submitting = createOrder.isPending || createRound.isPending;
  const rounds = mode === 'OPEN_TABLE' ? (openOrder.data as unknown as Recovery)?.session.children ?? [] : [];
  const roundsTotal = rounds.reduce((sum, r) => sum + Number(r.total), 0);

  if (openOrder.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="text-text-muted text-sm font-semibold">Loading…</div>
      </div>
    );
  }

  if (!mode) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg px-4">
        <div className="w-full max-w-xs bg-surface border border-border rounded-2xl p-8 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-accent flex items-center justify-center text-white font-display text-3xl leading-none mb-4">
            K
          </div>
          <h1 className="font-display text-2xl text-text mb-1">Kopi &amp; Co</h1>
          <p className="text-text-muted text-sm font-semibold mb-6">How are you ordering?</p>
          <div className="flex flex-col gap-2.5">
            <Button variant="primary" className="w-full" onClick={chooseOpenTable} disabled={startSession.isPending}>
              Open a Table
            </Button>
            <Button variant="outline" className="w-full" onClick={() => setMode('ORDINARY')}>
              One-time Order
            </Button>
          </div>
          <p className="text-text-muted text-[10.5px] font-semibold mt-4 leading-snug">
            Open a Table keeps your tab running for the whole visit -- order as many rounds as you like, pay once at the
            end. One-time order is a single order paid up front.
          </p>
          {startSession.isError && (
            <p className="text-warning text-xs font-semibold mt-3">{startSession.error.message}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen md:h-screen overflow-y-auto md:overflow-hidden flex flex-col bg-bg">
      <PageHeader
        title="Kopi & Co"
        subtitle="Self-order"
        right={
          <>
            {mode === 'OPEN_TABLE' && !sessionFinished && (
              <>
                <span className="text-[11px] font-bold text-text-muted-2 bg-surface-input px-3 py-1.5 rounded-full">
                  Table open
                </span>
                <button
                  onClick={() => setOrderSummaryOpen(true)}
                  className="text-xs font-bold text-text-muted-2 px-3 py-2 rounded-lg hover:bg-surface-input transition-colors"
                >
                  My Order{rounds.length > 0 ? ` (${rounds.length})` : ''}
                </button>
                <button
                  onClick={finishTable}
                  disabled={finishSession.isPending}
                  className="text-xs font-bold text-warning px-3 py-2 rounded-lg hover:bg-surface-input transition-colors disabled:opacity-50"
                >
                  Finish table
                </button>
              </>
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
                disabled={!cart.length}
                onClick={openReview}
              >
                {mode === 'OPEN_TABLE' ? 'Submit Round' : 'Submit order'}
              </Button>
            </div>
          </aside>
        </div>

      {reviewOpen && (
        <div className="fixed inset-0 z-50 bg-dark-ui/60 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-[420px] bg-surface rounded-3xl overflow-hidden shadow-2xl">
            {!placed ? (
              <div>
                <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-border">
                  <div>
                    <div className="font-display text-xl text-text">
                      {mode === 'OPEN_TABLE' ? 'Submit Round' : 'Confirm Order'}
                    </div>
                    <div className="text-xs text-text-muted font-semibold mt-0.5">{cartCount} items</div>
                  </div>
                  <button
                    onClick={closeReview}
                    aria-label="Close"
                    className="w-8 h-8 rounded-lg bg-surface-input text-accent-tint flex items-center justify-center shrink-0"
                  >
                    ✕
                  </button>
                </div>
                <div className="p-5">
                  <div className="flex flex-col gap-1.5 mb-4">
                    {cart.map((line) => {
                      const item = items.find((i) => i.id === line.menuItemId);
                      return (
                        <div key={line.menuItemId} className="flex justify-between items-baseline text-sm">
                          <span className="text-text-muted-2 font-semibold">
                            {line.qty}× {item?.name ?? 'Item'}
                          </span>
                          <span className="font-bold text-text">
                            Rp {item ? (Number(item.price) * line.qty).toLocaleString('id-ID') : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex justify-between items-baseline px-4 py-3.5 bg-surface-input rounded-2xl mb-5">
                    <span className="text-sm font-bold text-accent-tint">Total</span>
                    <span className="text-2xl font-extrabold text-accent">Rp {cartTotal.toLocaleString('id-ID')}</span>
                  </div>

                  <Button
                    variant="primary"
                    className="w-full"
                    disabled={submitting}
                    onClick={confirmOrder}
                  >
                    {mode === 'OPEN_TABLE' ? 'Submit Round' : 'Confirm Order'}
                  </Button>
                  {createOrder.isError && (
                    <p className="text-warning text-xs font-semibold mt-2 text-center">{createOrder.error.message}</p>
                  )}
                  {createRound.isError && (
                    <p className="text-warning text-xs font-semibold mt-2 text-center">{createRound.error.message}</p>
                  )}
                </div>
              </div>
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="px-8 py-14 flex flex-col items-center gap-3"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 16 }}
                  className="w-16 h-16 rounded-full bg-success flex items-center justify-center"
                >
                  <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <motion.path
                      d="M5 13l4 4L19 7"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.4, delay: 0.15, ease: 'easeOut' }}
                    />
                  </svg>
                </motion.div>
                <div className="font-display text-xl text-text">
                  {mode === 'OPEN_TABLE' ? 'Round placed' : 'Order placed'}
                </div>
                <div className="text-sm text-text-muted font-semibold text-center">
                  {mode === 'OPEN_TABLE'
                    ? 'Staff will send it to the kitchen shortly.'
                    : 'A staff member will confirm your order shortly.'}
                </div>
              </motion.div>
            )}
          </div>
        </div>
      )}

      {orderSummaryOpen && (
        <div className="fixed inset-0 z-50 bg-dark-ui/60 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-[420px] bg-surface rounded-3xl overflow-hidden shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-border shrink-0">
              <div>
                <div className="font-display text-xl text-text">My Order</div>
                <div className="text-xs text-text-muted font-semibold mt-0.5">
                  {rounds.length} round{rounds.length === 1 ? '' : 's'} so far
                </div>
              </div>
              <button
                onClick={() => setOrderSummaryOpen(false)}
                aria-label="Close"
                className="w-8 h-8 rounded-lg bg-surface-input text-accent-tint flex items-center justify-center shrink-0"
              >
                ✕
              </button>
            </div>
            <div className="p-5 overflow-y-auto">
              {rounds.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 text-center py-10 text-text-muted">
                  <div className="w-12 h-12 rounded-2xl bg-surface-input flex items-center justify-center text-xl">🧺</div>
                  <div className="text-xs">No rounds submitted yet.</div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 mb-4">
                  {rounds.map((round, i) => (
                    <div key={round.id} className="bg-surface-input rounded-xl px-3.5 py-3">
                      <div className="flex items-baseline justify-between gap-2 mb-1.5">
                        <span className="text-xs font-extrabold text-text-muted-2">Round {i + 1}</span>
                        <span className="text-xs font-bold text-text">
                          Rp {Number(round.total).toLocaleString('id-ID')}
                        </span>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        {round.items.map((line) => (
                          <div key={line.id} className="text-xs text-text-muted-2 font-semibold">
                            {line.qty}× {line.menuItem.name}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t border-border p-5 shrink-0">
              <div className="flex justify-between items-baseline">
                <span className="font-extrabold text-text">Total so far</span>
                <span className="font-extrabold text-xl text-accent">Rp {roundsTotal.toLocaleString('id-ID')}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {finishedOpen && (
        <div className="fixed inset-0 z-50 bg-dark-ui/60 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-[420px] bg-surface rounded-3xl overflow-hidden shadow-2xl">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="px-8 py-14 flex flex-col items-center gap-3"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 16 }}
                className="w-16 h-16 rounded-full bg-success flex items-center justify-center"
              >
                <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <motion.path
                    d="M5 13l4 4L19 7"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.4, delay: 0.15, ease: 'easeOut' }}
                  />
                </svg>
              </motion.div>
              <div className="font-display text-xl text-text">Table finished</div>
              <div className="text-sm text-text-muted font-semibold text-center">
                A staff member will bring your bill and close out the table shortly.
              </div>
            </motion.div>
          </div>
        </div>
      )}
    </div>
  );
}

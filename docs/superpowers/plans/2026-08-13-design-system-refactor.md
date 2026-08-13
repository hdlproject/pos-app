# Design System Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle all 7 existing frontend pages to match the "Kopi & Co" design system provided in `/design/*.dc.html` mockups — visual and layout only, same tRPC calls and component logic as today.

**Architecture:** Add Tailwind CSS (currently absent) with a theme extension encoding the mockups' design tokens. Build 4 small shared UI primitives, one new `AdminLayout` nested layout for the 4 admin routes, then restyle each page in place, preserving every existing handler, tRPC call, and TS2589 type-workaround exactly.

**Tech Stack:** Next.js 16 (App Router), Tailwind CSS (latest), TypeScript, tRPC (unchanged).

## Global Constraints

- Visual/layout refactor only — no new tRPC procedures, no backend changes, no new dependencies besides Tailwind and its build plugin.
- No AI assistant, no tax calculation, no item photos, no payment modal, no item badges — all explicitly out of scope per the spec (`docs/superpowers/specs/2026-08-13-design-system-refactor-design.md`), regardless of what the mockups show.
- Every page's existing tRPC calls, mutations, and TS2589 hand-written type workarounds (`KdsOrder` in `kds/page.tsx`, `BestSeller` in `admin/reports/page.tsx`, `CreatedOrder` in `order/[tableToken]/page.tsx`) must be preserved exactly — only markup/className/layout structure changes.
- Category filtering (client-side, from already-fetched data) is the one approved new bit of local UI state — not a new backend capability, just organizing existing data per the approved "adopt layout patterns" decision. No other new interactive capabilities (no cart-line decrement/remove, no clear-cart button) — those aren't in today's pages and are out of scope for this refactor.
- `npm run build` must stay clean after every task — the real gate, established after a build-breaking regression went undetected for several tasks in the original v1 implementation.
- Manual browser verification is required for the final task — skipping this on the original 5 frontend pages let two real bugs through undetected by build/tsc checks alone.

---

## File Structure

```
postcss.config.mjs          (new — Tailwind v4 PostCSS plugin registration)
src/app/globals.css         (replaced — Tailwind import + @theme design tokens)
src/app/layout.tsx           (modified — Manrope + DM Serif Display fonts replace Geist)

src/components/ui/
  Button.tsx                (new — primary/dark/outline/success variants)
  Card.tsx                  (new — bordered rounded surface)
  Chip.tsx                  (new — filter pill, active/inactive)
  PageHeader.tsx             (new — sticky top bar, light/dark palette)

src/app/(staff)/admin/layout.tsx   (new — sidebar nav shell wrapping all 4 admin pages)

src/app/login/page.tsx                    (restyled)
src/app/(staff)/pos/page.tsx              (restyled)
src/app/(staff)/kds/page.tsx              (restyled)
src/app/order/[tableToken]/page.tsx       (restyled)
src/app/(staff)/admin/menu/page.tsx       (restyled)
src/app/(staff)/admin/ingredients/page.tsx (restyled)
src/app/(staff)/admin/tables/page.tsx     (restyled)
src/app/(staff)/admin/reports/page.tsx    (restyled)
```

---

### Task 1: Tailwind CSS Setup & Design Tokens

**Files:**
- Create: `postcss.config.mjs`
- Modify: `src/app/globals.css` (full replacement)
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Produces: Tailwind utility classes for every design token below (e.g. `bg-accent`, `text-kds-text`, `font-display`) — every later task's className strings depend on these exact token names existing.

- [ ] **Step 1: Install Tailwind**

```bash
npm install tailwindcss @tailwindcss/postcss postcss
```

Check `node_modules/tailwindcss/package.json`'s `"version"` field after install. This plan assumes Tailwind v4's CSS-first configuration (no `tailwind.config.ts`, tokens declared via `@theme` in CSS). If a different major version installed, adapt the mechanism to that version's documented Next.js integration while keeping every token name below identical — later tasks reference these names directly.

- [ ] **Step 2: Register the PostCSS plugin**

```js
// postcss.config.mjs
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

- [ ] **Step 3: Replace `globals.css` with the Tailwind import and design tokens**

```css
/* src/app/globals.css */
@import "tailwindcss";

@theme {
  --font-sans: var(--font-manrope), system-ui, sans-serif;
  --font-display: var(--font-dm-serif-display), serif;

  --color-bg: #f3ede3;
  --color-surface: #fffdf9;
  --color-surface-input: #faf6ef;
  --color-border: #e9e0d2;
  --color-border-strong: #e6dccb;
  --color-text: #2a241d;
  --color-text-muted: #a9997f;
  --color-text-muted-2: #8a7c66;
  --color-accent: #c65d3b;
  --color-accent-hover: #a94a2c;
  --color-accent-tint: #8a5a3c;
  --color-success: #0e8a6a;
  --color-warning: #c0492c;
  --color-dark-ui: #2a241d;

  --color-kds-bg: #1a1712;
  --color-kds-header: #211d16;
  --color-kds-card: #241f18;
  --color-kds-card-header: #26211a;
  --color-kds-border: #322b21;
  --color-kds-text: #f2e9dc;
  --color-kds-text-muted: #8a7c66;
  --color-kds-text-muted-2: #b8ab95;
  --color-status-queued: #7d7364;
  --color-status-preparing: #e0a86a;
  --color-status-ready: #5fbf7f;
}

html {
  height: 100%;
}

body {
  min-height: 100%;
}
```

- [ ] **Step 4: Swap the root layout's fonts from Geist to Manrope + DM Serif Display**

```tsx
// src/app/layout.tsx
import type { Metadata } from "next";
import { Manrope, DM_Serif_Display } from "next/font/google";
import { TrpcProvider } from "@/components/trpc-provider";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const dmSerifDisplay = DM_Serif_Display({
  variable: "--font-dm-serif-display",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "POS",
  description: "Restaurant & cafe point of sale",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${manrope.variable} ${dmSerifDisplay.variable}`}>
      <body className="font-sans bg-bg text-text antialiased">
        <TrpcProvider>{children}</TrpcProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Run build to verify clean**

Run: `npm run build`
Expected: succeeds with no TypeScript or CSS errors. If Tailwind's PostCSS plugin fails to resolve `@theme` tokens, re-check the installed version's exact CSS-first syntax (Step 1 note) and adjust.

- [ ] **Step 6: Commit**

```bash
git add postcss.config.mjs src/app/globals.css src/app/layout.tsx package.json package-lock.json
git commit -m "feat: add Tailwind CSS with Kopi & Co design tokens"
```

---

### Task 2: Shared UI Primitives

**Files:**
- Create: `src/components/ui/Button.tsx`, `src/components/ui/Card.tsx`, `src/components/ui/Chip.tsx`, `src/components/ui/PageHeader.tsx`

**Interfaces:**
- Consumes: Tailwind tokens from Task 1 (`bg-accent`, `bg-dark-ui`, `bg-kds-header`, etc.)
- Produces: `Button({ variant?: 'primary'|'dark'|'outline'|'success', ...ButtonHTMLAttributes })`, `Card({ ...HTMLAttributes<HTMLDivElement> })`, `Chip({ active?, count?, children, onClick? })`, `PageHeader({ title, subtitle?, dark?, right? })` — every page task from Task 4 onward imports these by name from `@/components/ui/<Name>`.

- [ ] **Step 1: Write `Button.tsx`**

```tsx
// src/components/ui/Button.tsx
import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'dark' | 'outline' | 'success';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover disabled:bg-accent/40',
  dark: 'bg-dark-ui text-white hover:bg-dark-ui/90 disabled:bg-dark-ui/40',
  outline: 'bg-surface text-text-muted-2 border border-border-strong hover:bg-surface-input disabled:opacity-50',
  success: 'bg-success text-white hover:bg-success/90 disabled:bg-success/40',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={`px-4 py-2.5 rounded-xl font-bold text-sm transition-colors disabled:cursor-not-allowed disabled:pointer-events-none ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
}
```

- [ ] **Step 2: Write `Card.tsx`**

```tsx
// src/components/ui/Card.tsx
import type { HTMLAttributes } from 'react';

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`bg-surface border border-border rounded-2xl p-4 ${className}`} {...props} />;
}
```

- [ ] **Step 3: Write `Chip.tsx`**

```tsx
// src/components/ui/Chip.tsx
import type { ReactNode } from 'react';

type ChipProps = {
  active?: boolean;
  count?: number;
  children: ReactNode;
  onClick?: () => void;
};

export function Chip({ active = false, count, children, onClick }: ChipProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border font-bold text-sm transition-colors ${
        active ? 'bg-accent border-accent text-white' : 'bg-surface border-border-strong text-text-muted-2'
      }`}
    >
      <span>{children}</span>
      {count !== undefined && (
        <span
          className={`text-[11px] font-extrabold px-1.5 rounded-full ${
            active ? 'bg-white/20 text-white' : 'bg-surface-input text-text-muted'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 4: Write `PageHeader.tsx`**

```tsx
// src/components/ui/PageHeader.tsx
import type { ReactNode } from 'react';

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  dark?: boolean;
  right?: ReactNode;
};

export function PageHeader({ title, subtitle, dark = false, right }: PageHeaderProps) {
  return (
    <header
      className={`flex items-center gap-4 px-6 py-3.5 sticky top-0 z-20 border-b ${
        dark ? 'bg-kds-header border-kds-border' : 'bg-surface border-border'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center text-white font-display text-2xl leading-none">
          K
        </div>
        <div className="leading-tight">
          <div className={`font-display text-lg ${dark ? 'text-kds-text' : 'text-text'}`}>{title}</div>
          {subtitle && (
            <div className={`text-[11px] font-bold uppercase tracking-wider ${dark ? 'text-kds-text-muted' : 'text-text-muted'}`}>
              {subtitle}
            </div>
          )}
        </div>
      </div>
      {right && <div className="ml-auto flex items-center gap-4">{right}</div>}
    </header>
  );
}
```

- [ ] **Step 5: Run build to verify clean**

Run: `npm run build`
Expected: succeeds — these components aren't imported anywhere yet, so this just confirms no syntax/type errors in the new files.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui
git commit -m "feat: add shared UI primitives (Button, Card, Chip, PageHeader)"
```

---

### Task 3: Admin Sidebar Layout

**Files:**
- Create: `src/app/(staff)/admin/layout.tsx`

**Interfaces:**
- Produces: a Next.js nested layout wrapping every route under `/admin/*` — Tasks 8-11 (the 4 admin pages) render inside this shell and should NOT repeat the sidebar/nav markup themselves.

- [ ] **Step 1: Write the layout**

```tsx
// src/app/(staff)/admin/layout.tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/admin/menu', label: 'Menu' },
  { href: '/admin/ingredients', label: 'Ingredients' },
  { href: '/admin/tables', label: 'Tables' },
  { href: '/admin/reports', label: 'Reports' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen flex bg-bg">
      <aside className="w-[230px] shrink-0 bg-surface border-r border-border flex flex-col p-3.5 sticky top-0 h-screen">
        <div className="flex items-center gap-3 px-2 pb-5">
          <div className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center text-white font-display text-xl leading-none">
            K
          </div>
          <div className="leading-tight">
            <div className="font-display text-base text-text">Kopi &amp; Co</div>
            <div className="text-[10.5px] uppercase tracking-widest text-text-muted font-bold">Admin</div>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-2.5 rounded-xl font-bold text-sm ${
                  active ? 'bg-accent text-white' : 'text-text-muted-2 hover:bg-surface-input'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Run build to verify clean**

Run: `npm run build`
Expected: succeeds. The 4 admin pages still render with their old unstyled markup at this point (restyled in Tasks 8-11) — they'll appear nested inside the new sidebar shell, which is expected and will look inconsistent until those tasks land.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(staff)/admin/layout.tsx"
git commit -m "feat: add admin sidebar layout shell"
```

---

### Task 4: Login Page Restyle

**Files:**
- Modify: `src/app/login/page.tsx` (full replacement)

**Interfaces:**
- Consumes: `Button` (Task 2). No tRPC/logic changes — `trpc.auth.login.useMutation` call is identical to the current file.

- [ ] **Step 1: Replace the page**

```tsx
// src/app/login/page.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';

export default function LoginPage() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();
  const login = trpc.auth.login.useMutation({
    onSuccess: () => router.push('/pos'),
    onError: () => setError('Invalid PIN'),
  });

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="w-full max-w-xs bg-surface border border-border rounded-2xl p-8 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-accent flex items-center justify-center text-white font-display text-3xl leading-none mb-4">
          K
        </div>
        <h1 className="font-display text-2xl text-text mb-1">Kopi &amp; Co</h1>
        <p className="text-text-muted text-sm font-semibold mb-6">Staff login</p>
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN"
          className="w-full text-center text-2xl font-extrabold tracking-[0.3em] px-4 py-3 border border-border-strong rounded-xl bg-surface-input text-text outline-none mb-4"
        />
        <Button variant="primary" className="w-full" onClick={() => login.mutate({ pin })} disabled={login.isPending}>
          Login
        </Button>
        {error && (
          <p role="alert" className="text-warning text-sm font-semibold mt-3">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Run build to verify clean**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/login/page.tsx
git commit -m "feat: restyle login page"
```

---

### Task 5: Staff POS Page Restyle

**Files:**
- Modify: `src/app/(staff)/pos/page.tsx` (full replacement)

**Interfaces:**
- Consumes: `Button`, `Card`, `Chip` (Task 2). Same `trpc.menu.listAll`, `trpc.table.list`, `trpc.order.createStaff` calls as the current file — only a new local `category` state is added (client-side filter, per Global Constraints).

- [ ] **Step 1: Replace the page**

```tsx
// src/app/(staff)/pos/page.tsx
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
                <Button variant="dark" className="px-3 py-2 text-xs" onClick={() => addToCart(item.id)}>
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
```

- [ ] **Step 2: Run build to verify clean**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(staff)/pos/page.tsx"
git commit -m "feat: restyle staff POS page"
```

---

### Task 6: Kitchen Display Page Restyle

**Files:**
- Modify: `src/app/(staff)/kds/page.tsx` (full replacement)

**Interfaces:**
- Consumes: `PageHeader` (Task 2). Same `trpc.order.listOpen`, `trpc.kitchen.updateItemStatus`, Ably subscription logic, and `KdsOrder` hand-written type as the current file — preserved verbatim (do not alter the type or its explanatory comment, do not touch the `useEffect` Ably wiring).

- [ ] **Step 1: Replace the page**

```tsx
// src/app/(staff)/kds/page.tsx
'use client';
import { useEffect } from 'react';
import Ably from 'ably';
import { trpc } from '@/lib/trpc-client';
import { PageHeader } from '@/components/ui/PageHeader';

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
      <PageHeader title="Kitchen Display" subtitle="Kopi & Co · Live" dark />
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
                            className="px-2 py-1 rounded-lg bg-kds-card-header text-kds-text-muted-2 text-[11px] font-bold"
                          >
                            Preparing
                          </button>
                          <button
                            onClick={() => updateStatus.mutate({ orderItemId: item.id, status: 'READY' })}
                            className="px-2 py-1 rounded-lg bg-status-ready text-kds-bg text-[11px] font-bold"
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
```

- [ ] **Step 2: Run build to verify clean**

Run: `npm run build`
Expected: succeeds. If the `KdsOrder` type workaround's TS2589 avoidance stops working after this edit, the cause is unrelated to this task's changes (only markup changed, not the type or the query) — investigate rather than reintroducing the deep-inference path.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(staff)/kds/page.tsx"
git commit -m "feat: restyle kitchen display page"
```

---

### Task 7: QR Customer Order Page Restyle

**Files:**
- Modify: `src/app/order/[tableToken]/page.tsx` (full replacement)

**Interfaces:**
- Consumes: `Button` (Task 2). Same `trpc.menu.listAvailable`, `trpc.order.createByTable`, `trpc.order.appendItems`, `trpc.order.getOpenOrderByTableToken` calls, the `CreatedOrder` type workaround, and the open-order-recovery `useEffect` as the current file — preserved verbatim. Adds a local `category` filter state (client-side, per Global Constraints).

- [ ] **Step 1: Replace the page**

```tsx
// src/app/order/[tableToken]/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';

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

  const items = menu.data ?? [];
  const categories = ['All', ...Array.from(new Set(items.map((i) => i.category.name)))];
  const visibleItems = category === 'All' ? items : items.filter((i) => i.category.name === category);
  const cartCount = cart.reduce((sum, l) => sum + l.qty, 0);

  return (
    <div className="min-h-screen flex items-start justify-center p-4 bg-[radial-gradient(120%_60%_at_50%_0%,#e7dccb,#d3c6b3)]">
      <div className="relative w-full max-w-[412px] bg-surface rounded-[34px] overflow-hidden shadow-2xl flex flex-col h-[844px] max-h-[calc(100vh-32px)]">
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
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`shrink-0 px-3.5 py-2 rounded-xl border font-bold text-sm ${
                    category === c ? 'bg-accent border-accent text-white' : 'bg-surface border-border-strong text-text-muted-2'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="px-4 pb-24 pt-1.5 flex flex-col gap-3">
            {visibleItems.map((item) => (
              <div key={item.id} className="flex gap-3 bg-surface border border-border rounded-2xl p-3">
                <div className="flex-1 min-w-0 flex flex-col">
                  <span className="font-extrabold text-sm text-text">{item.name}</span>
                  <div className="flex items-center justify-between mt-auto pt-2">
                    <span className="font-extrabold text-sm text-accent-tint">Rp {String(item.price)}</span>
                    <button
                      onClick={() => addToCart(item.id)}
                      className="px-4 py-2 rounded-lg bg-dark-ui text-white font-extrabold text-xs"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {cartCount > 0 && (
          <div className="absolute left-0 right-0 bottom-0 p-4 bg-gradient-to-t from-surface via-surface/95 to-transparent">
            <div className="bg-dark-ui rounded-2xl p-1.5 flex items-center gap-2.5 shadow-lg">
              <div className="flex items-center gap-3 py-2 pl-3 flex-1">
                <span className="w-8 h-8 rounded-lg bg-accent text-white flex items-center justify-center text-sm font-extrabold">
                  {cartCount}
                </span>
                <div className="text-white text-sm font-bold">{orderId ? 'Add to open tab' : 'Start order'}</div>
              </div>
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
```

- [ ] **Step 2: Run build to verify clean**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add "src/app/order/[tableToken]/page.tsx"
git commit -m "feat: restyle QR customer order page"
```

---

### Task 8: Admin Menu Page Restyle

**Files:**
- Modify: `src/app/(staff)/admin/menu/page.tsx` (full replacement)

**Interfaces:**
- Consumes: `Button`, `Card` (Task 2), `AdminLayout` (Task 3, applies automatically via Next.js's nested layout — do not add sidebar markup here). Same `trpc.menu.listAll`, `trpc.menu.listCategories`, `trpc.menu.createCategory`, `trpc.menu.createItem`, `trpc.menu.updateItem` calls as the current file.

- [ ] **Step 1: Replace the page**

```tsx
// src/app/(staff)/admin/menu/page.tsx
'use client';
import { useState } from 'react';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

export default function AdminMenuPage() {
  const utils = trpc.useUtils();
  const items = trpc.menu.listAll.useQuery();
  const categoriesQuery = trpc.menu.listCategories.useQuery();
  const [categoryName, setCategoryName] = useState('');
  const createCategory = trpc.menu.createCategory.useMutation({
    onSuccess: () => {
      utils.menu.listAll.invalidate();
      utils.menu.listCategories.invalidate();
    },
  });

  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const createItem = trpc.menu.createItem.useMutation({
    onSuccess: () => { utils.menu.listAll.invalidate(); setName(''); setPrice(''); },
  });
  const toggleAvailable = trpc.menu.updateItem.useMutation({ onSuccess: () => utils.menu.listAll.invalidate() });

  const categories = categoriesQuery.data ?? [];

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl text-text mb-6">Menu Management</h1>

      <Card className="mb-5">
        <h2 className="font-bold text-text mb-3">New Category</h2>
        <div className="flex gap-2">
          <input
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            placeholder="Category name"
            className="flex-1 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none"
          />
          <Button variant="primary" onClick={() => { createCategory.mutate({ name: categoryName }); setCategoryName(''); }}>
            Add Category
          </Button>
        </div>
      </Card>

      <Card className="mb-5">
        <h2 className="font-bold text-text mb-3">New Item</h2>
        <div className="flex gap-2 flex-wrap">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Item name"
            className="flex-1 min-w-[160px] px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none"
          />
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Price"
            type="number"
            className="w-28 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none"
          />
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none"
          >
            <option value="">Select category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <Button
            variant="dark"
            disabled={!name || !price || !categoryId}
            onClick={() => createItem.mutate({ name, price: Number(price), categoryId, available: true })}
          >
            Add Item
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="font-bold text-text mb-3">Items</h2>
        <div className="flex flex-col gap-2">
          {items.data?.map((item) => (
            <div key={item.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <div>
                <span className="font-bold text-sm text-text">{item.name}</span>
                <span className="text-text-muted text-sm ml-2">Rp {String(item.price)}</span>
                <span className={`text-xs font-bold ml-2 ${item.available ? 'text-success' : 'text-warning'}`}>
                  {item.available ? 'available' : 'sold out'}
                </span>
              </div>
              <Button
                variant="outline"
                className="text-xs px-3 py-1.5"
                onClick={() => toggleAvailable.mutate({ id: item.id, available: !item.available })}
              >
                {item.available ? 'Mark sold out' : 'Mark available'}
              </Button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Run build to verify clean**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(staff)/admin/menu/page.tsx"
git commit -m "feat: restyle admin menu management page"
```

---

### Task 9: Admin Ingredients Page Restyle

**Files:**
- Modify: `src/app/(staff)/admin/ingredients/page.tsx` (full replacement)

**Interfaces:**
- Consumes: `Button`, `Card` (Task 2), `AdminLayout` (Task 3). Same `trpc.ingredient.list`, `trpc.ingredient.create`, `trpc.ingredient.adjustStock` calls as the current file.

- [ ] **Step 1: Replace the page**

```tsx
// src/app/(staff)/admin/ingredients/page.tsx
'use client';
import { useState } from 'react';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

export default function AdminIngredientsPage() {
  const utils = trpc.useUtils();
  const ingredients = trpc.ingredient.list.useQuery();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [threshold, setThreshold] = useState('');
  const create = trpc.ingredient.create.useMutation({
    onSuccess: () => { utils.ingredient.list.invalidate(); setName(''); setUnit(''); setThreshold(''); },
  });
  const adjust = trpc.ingredient.adjustStock.useMutation({ onSuccess: () => utils.ingredient.list.invalidate() });

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl text-text mb-6">Ingredients</h1>

      <Card className="mb-5">
        <h2 className="font-bold text-text mb-3">New Ingredient</h2>
        <div className="flex gap-2 flex-wrap">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="flex-1 min-w-[140px] px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none"
          />
          <input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="Unit (g, ml, pcs)"
            className="w-40 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none"
          />
          <input
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder="Low-stock threshold"
            type="number"
            className="w-44 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none"
          />
          <Button
            variant="dark"
            disabled={!name || !unit || !threshold}
            onClick={() => create.mutate({ name, unit, lowStockThreshold: Number(threshold), stockQty: 0 })}
          >
            Add Ingredient
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="font-bold text-text mb-3">Stock</h2>
        <div className="flex flex-col gap-2">
          {ingredients.data?.map((ing) => {
            const low = Number(ing.stockQty) < Number(ing.lowStockThreshold);
            return (
              <div key={ing.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div className={low ? 'text-warning' : 'text-text'}>
                  <span className="font-bold text-sm">{ing.name}</span>
                  <span className="text-sm ml-2">{String(ing.stockQty)} {ing.unit}</span>
                  {low && <span className="text-xs font-extrabold ml-2">LOW STOCK</span>}
                </div>
                <Button
                  variant="outline"
                  className="text-xs px-3 py-1.5"
                  onClick={() => adjust.mutate({ ingredientId: ing.id, delta: 100, reason: 'RESTOCK' })}
                >
                  +100 Restock
                </Button>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Run build to verify clean**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(staff)/admin/ingredients/page.tsx"
git commit -m "feat: restyle admin ingredients page"
```

---

### Task 10: Admin Tables Page Restyle

**Files:**
- Modify: `src/app/(staff)/admin/tables/page.tsx` (full replacement)

**Interfaces:**
- Consumes: `Button`, `Card` (Task 2), `AdminLayout` (Task 3). Same `trpc.table.list`, `trpc.table.create`, `trpc.table.rotateToken` calls as the current file.

- [ ] **Step 1: Replace the page**

```tsx
// src/app/(staff)/admin/tables/page.tsx
'use client';
import { useState } from 'react';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

export default function AdminTablesPage() {
  const utils = trpc.useUtils();
  const tables = trpc.table.list.useQuery();
  const [label, setLabel] = useState('');
  const create = trpc.table.create.useMutation({ onSuccess: () => { utils.table.list.invalidate(); setLabel(''); } });
  const rotate = trpc.table.rotateToken.useMutation({ onSuccess: () => utils.table.list.invalidate() });

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl text-text mb-6">Tables</h1>

      <Card className="mb-5">
        <div className="flex gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Table label (e.g. T5)"
            className="flex-1 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none"
          />
          <Button variant="dark" disabled={!label} onClick={() => create.mutate({ label })}>
            Add Table
          </Button>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-2">
          {tables.data?.map((t) => (
            <div key={t.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <div>
                <span className="font-bold text-sm text-text">{t.label}</span>
                <span className="text-text-muted text-xs ml-2">/order/{t.qrToken}</span>
              </div>
              <Button variant="outline" className="text-xs px-3 py-1.5" onClick={() => rotate.mutate({ id: t.id })}>
                Rotate QR Token
              </Button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Run build to verify clean**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(staff)/admin/tables/page.tsx"
git commit -m "feat: restyle admin tables page"
```

---

### Task 11: Admin Reports Page Restyle

**Files:**
- Modify: `src/app/(staff)/admin/reports/page.tsx` (full replacement)

**Interfaces:**
- Consumes: `Card` (Task 2), `AdminLayout` (Task 3). Same `trpc.report.dailySales`, `trpc.report.bestSellers`, `trpc.report.inventoryUsage`, `trpc.report.shiftSummary` calls, the date-range state/computation, and the `BestSeller` hand-written type workaround as the current file — preserved verbatim.

- [ ] **Step 1: Replace the page**

```tsx
// src/app/(staff)/admin/reports/page.tsx
'use client';
import { useState } from 'react';
import { trpc } from '@/lib/trpc-client';
import { Card } from '@/components/ui/Card';

// Explicit view of the JSON-serialized shape returned by report.bestSellers,
// limited to the fields this page's JSX uses. (Deriving the type directly
// from the tRPC procedure hits TS2589 "Type instantiation is excessively
// deep and possibly infinite" here, because MenuItem's `modifiers Json?`
// field pulls in Prisma's recursive JsonValue union, which pushes the
// compiler past its recursion limit when combined with tRPC's output
// inference. This mirrors the real over-the-wire JSON shape.)
type BestSeller = {
  menuItem: { id: string; name: string } | undefined;
  qtySold: number;
};

export default function ReportsPage() {
  const [from, setFrom] = useState(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const range = {
    from: new Date(from).toISOString(),
    to: new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1).toISOString(),
  };

  const sales = trpc.report.dailySales.useQuery(range);
  const best = trpc.report.bestSellers.useQuery(range);
  const bestData = best.data as unknown as BestSeller[] | undefined;
  const usage = trpc.report.inventoryUsage.useQuery(range);
  const shift = trpc.report.shiftSummary.useQuery(range);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="font-display text-2xl text-text">Reports</h1>
        <div className="flex gap-2 items-center text-sm">
          <label className="flex items-center gap-1.5 text-text-muted-2 font-semibold">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="px-2 py-1.5 border border-border-strong rounded-lg bg-surface-input outline-none"
            />
          </label>
          <label className="flex items-center gap-1.5 text-text-muted-2 font-semibold">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="px-2 py-1.5 border border-border-strong rounded-lg bg-surface-input outline-none"
            />
          </label>
        </div>
      </div>

      <div className="grid gap-4 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <Card>
          <div className="text-xs font-bold text-text-muted uppercase tracking-wide">Revenue</div>
          <div className="text-2xl font-extrabold text-text mt-2">Rp {sales.data?.totalRevenue ?? 0}</div>
        </Card>
        <Card>
          <div className="text-xs font-bold text-text-muted uppercase tracking-wide">Orders</div>
          <div className="text-2xl font-extrabold text-text mt-2">{sales.data?.orderCount ?? 0}</div>
        </Card>
        <Card>
          <div className="text-xs font-bold text-text-muted uppercase tracking-wide">Avg order value</div>
          <div className="text-2xl font-extrabold text-text mt-2">{sales.data?.avgOrderValue?.toFixed(2) ?? '0.00'}</div>
        </Card>
      </div>

      <Card className="mb-5">
        <h2 className="font-bold text-text mb-3">Best Sellers</h2>
        <div className="flex flex-col gap-1.5">
          {bestData?.map((row) => (
            <div key={row.menuItem?.id} className="flex justify-between text-sm py-1">
              <span className="text-text font-semibold">{row.menuItem?.name}</span>
              <span className="text-text-muted">{row.qtySold} sold</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mb-5">
        <h2 className="font-bold text-text mb-3">Inventory Usage</h2>
        {usage.data?.lowStock.map((ing) => (
          <div key={ing.id} className="text-warning text-sm font-bold py-1">{ing.name}: LOW STOCK</div>
        ))}
        {usage.data?.usage.map((m) => (
          <div key={m.id} className="text-sm text-text-muted py-1">
            {m.ingredient.name}: {String(m.delta)} ({m.reason})
          </div>
        ))}
      </Card>

      <Card>
        <h2 className="font-bold text-text mb-3">Shift Summary</h2>
        {shift.data?.map((s) => (
          <div key={s.name} className="flex justify-between text-sm py-1">
            <span className="text-text font-semibold">{s.name}</span>
            <span className="text-text-muted">{s.orderCount} orders, {s.total} collected</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Run build to verify clean**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(staff)/admin/reports/page.tsx"
git commit -m "feat: restyle admin reports page"
```

---

### Task 12: Full Manual Verification Pass

**Files:**
- None (verification only — no code changes expected; fix any bugs found as part of this task if they're small, otherwise report them).

**Interfaces:**
- None new.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify seed data is present**

The dev DB (`pos_dev`) should already have seed data (1 Admin user, PIN `1234`; 1 category; 1 menu item; 1 table with `qrToken: 'seed-table-1-token'`). If missing, reseed:

```bash
npx prisma db seed
```

- [ ] **Step 3: Click through every page in a real browser**

- `/login` — enter PIN `1234`, confirm redirect to `/pos`.
- `/pos` — confirm category chips filter the item grid, adding an item shows it in the cart panel with correct running total, order type tabs switch the table selector on/off correctly, submitting clears the cart and shows the success message.
- `/kds` — open in a second tab; submit an order from `/pos` or the QR page and confirm the ticket appears live (Ably push) without a manual refresh; click "Preparing"/"Ready" and confirm the item updates.
- `/order/seed-table-1-token` — confirm the menu renders, category chips filter it, adding items shows the floating cart bar, submitting shows "Sent to kitchen!" and the "tab stays open" message, and a page reload recovers the same open order (does not create a duplicate — this exact bug was caught by the final v1 review, verify the fix still holds here).
- `/admin/menu` — confirm the sidebar nav is visible and highlights the active page, category creation immediately populates the item-creation dropdown (this exact bug was also caught by the final v1 review — a fresh category should appear without needing an item in it first), item creation and availability toggling work.
- `/admin/ingredients` — confirm low-stock items render in red, restock button works.
- `/admin/tables` — confirm table creation and QR-token rotation work, and the displayed `/order/<token>` path matches what actually works when visited.
- `/admin/reports` — confirm the date range includes today's data (not just up to yesterday), KPI tiles and list sections render.

- [ ] **Step 4: Fix any bugs found**

If a bug is small and clearly scoped to this refactor's own changes (e.g. a wrong Tailwind class, a broken layout), fix it directly and re-verify. If a bug reveals a pre-existing issue unrelated to this refactor, report it rather than expanding this task's scope.

- [ ] **Step 5: Final full build check**

Run: `npm run build`
Expected: clean, all 12 routes listed (login, pos, kds, order/[tableToken], admin/menu, admin/ingredients, admin/tables, admin/reports, plus the 2 API routes and the root page).

- [ ] **Step 6: Commit any fixes from Step 4**

```bash
git add -A
git commit -m "fix: address issues found during manual verification"
```

(Skip this step if Step 4 found nothing to fix.)

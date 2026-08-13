# Logout Flow & Page Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a logout entry point (currently missing from the UI entirely) to `/pos`, `/kds`, and the admin sidebar, and add a uniform fade+slide page transition across all route changes via Framer Motion (`motion` package).

**Architecture:** A `LogoutButton` client component wraps `trpc.auth.logout.useMutation()` and is reused in three places. A `PageTransition` client component wraps the root layout's `{children}` in `AnimatePresence`, keyed by pathname, giving every navigation (including login→`/pos` and logout→`/login`) the same fade+slide animation with no special-casing in the login/logout logic itself.

**Tech Stack:** Next.js 16 (App Router), TypeScript, tRPC (unchanged), `motion` (new dependency).

## Global Constraints

- No backend changes — `auth.logout` already exists (`protectedProcedure`, no input, deletes the session cookie, returns `{ ok: true }`).
- No automated tests — pure UI/animation work, consistent with how this project's frontend has been verified throughout.
- The transition applies uniformly to every route change, not just login/logout — this is a deliberate, already-approved choice (App Router's standard `AnimatePresence` pattern can't cheaply be scoped to only two specific route pairs).
- `npm run build` must stay clean after every task.
- Correction from the design spec: the admin sidebar (`src/app/(staff)/admin/layout.tsx`) does NOT currently have a "user chip" block — it has only a logo/title header and nav links. The logout link goes in a new bottom-pinned block, not appended to an existing chip.

---

## File Structure

```
src/components/PageTransition.tsx     (new — AnimatePresence wrapper)
src/components/ui/LogoutButton.tsx    (new — shared logout control)
src/app/layout.tsx                    (modified — wrap {children} in PageTransition)
src/app/(staff)/pos/page.tsx          (modified — add PageHeader + LogoutButton)
src/app/(staff)/kds/page.tsx          (modified — add right={<LogoutButton dark />} to existing PageHeader)
src/app/(staff)/admin/layout.tsx      (modified — add bottom-pinned LogoutButton)
```

---

### Task 1: Install Framer Motion & Add Page Transitions

**Files:**
- Create: `src/components/PageTransition.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Produces: `PageTransition({ children }: { children: React.ReactNode })` — wraps any subtree in a fade+slide route transition. Later tasks don't consume this directly; it's wired once into the root layout.

- [ ] **Step 1: Install `motion`**

```bash
npm install motion
```

Check `node_modules/motion/package.json`'s `"version"` field after install. This plan assumes the current `motion/react` API (`AnimatePresence`, `motion.div` from `'motion/react'`). If a materially different major version installs, verify the import path and component API against that version's docs before proceeding, keeping the same visual behavior (fade + vertical slide, ~250ms).

- [ ] **Step 2: Write `PageTransition.tsx`**

```tsx
// src/components/PageTransition.tsx
'use client';
import { AnimatePresence, motion } from 'motion/react';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const variants = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -16 },
};

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        initial="initial"
        animate="animate"
        exit="exit"
        variants={variants}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
```

- [ ] **Step 3: Wrap the root layout's children**

```tsx
// src/app/layout.tsx
import type { Metadata } from "next";
import { Manrope, DM_Serif_Display } from "next/font/google";
import { TrpcProvider } from "@/components/trpc-provider";
import { PageTransition } from "@/components/PageTransition";
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
        <TrpcProvider>
          <PageTransition>{children}</PageTransition>
        </TrpcProvider>
      </body>
    </html>
  );
}
```

Only the `PageTransition` import and its wrapping of `{children}` change — everything else (fonts, `TrpcProvider`, `metadata`, `LayoutProps<"/">` typing) stays exactly as it was.

- [ ] **Step 4: Run build to verify clean**

Run: `npm run build`
Expected: succeeds. `AnimatePresence`/`motion.div` are client-only — confirm no server-component errors (the `'use client'` directive on `PageTransition.tsx` should prevent this).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/components/PageTransition.tsx src/app/layout.tsx
git commit -m "feat: add uniform fade+slide page transitions via Framer Motion"
```

---

### Task 2: Shared Logout Button

**Files:**
- Create: `src/components/ui/LogoutButton.tsx`

**Interfaces:**
- Consumes: `trpc.auth.logout` (`src/server/trpc/routers/auth.ts` — `protectedProcedure`, no input, returns `{ ok: true }` after deleting the session cookie).
- Produces: `LogoutButton({ dark?: boolean })` — Tasks 3, 4, 5 each import this by name from `@/components/ui/LogoutButton`.

- [ ] **Step 1: Write `LogoutButton.tsx`**

```tsx
// src/components/ui/LogoutButton.tsx
'use client';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc-client';

type LogoutButtonProps = {
  dark?: boolean;
};

export function LogoutButton({ dark = false }: LogoutButtonProps) {
  const router = useRouter();
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => router.push('/login'),
  });

  return (
    <button
      onClick={() => logout.mutate()}
      disabled={logout.isPending}
      className={`text-xs font-bold px-3 py-2 rounded-lg transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-offset-1 ${
        dark
          ? 'text-kds-text-muted hover:bg-kds-card-header focus-visible:ring-status-ready focus-visible:ring-offset-kds-bg'
          : 'text-text-muted-2 hover:bg-surface-input focus-visible:ring-accent'
      }`}
    >
      Log out
    </button>
  );
}
```

- [ ] **Step 2: Run build to verify clean**

Run: `npm run build`
Expected: succeeds. Not imported anywhere yet, so this just confirms the new file compiles.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/LogoutButton.tsx
git commit -m "feat: add shared LogoutButton component"
```

---

### Task 3: Add Header & Logout to Staff POS Page

**Files:**
- Modify: `src/app/(staff)/pos/page.tsx`

**Interfaces:**
- Consumes: `PageHeader` (`src/components/ui/PageHeader.tsx` — `{ title, subtitle?, dark?, right? }`), `LogoutButton` (Task 2).

`/pos` currently has no header at all — the outer element goes straight into the two-pane `main`/`aside` layout. This task adds a `PageHeader` above that layout without breaking the existing viewport-height scroll containment (`h-screen overflow-hidden` on the outer div, `overflow-y-auto` on the menu grid and cart-lines panel) that a prior fix established — adding a header row means the outer div becomes `flex-col`, and the row containing `main`+`aside` needs `min-h-0` so it can still shrink and let its children's own scroll containers work (flex items default to `min-height: auto`, which would otherwise prevent the row from shrinking below its content size and silently break the existing scroll fix).

- [ ] **Step 1: Update the page**

Change the imports at the top to add:
```tsx
import { PageHeader } from '@/components/ui/PageHeader';
import { LogoutButton } from '@/components/ui/LogoutButton';
```

Change the returned JSX's outer structure from:
```tsx
    <div className="h-screen overflow-hidden flex bg-bg">
      <main className="flex-1 min-w-0 flex flex-col p-6 overflow-y-auto">
        {/* ...unchanged menu grid content... */}
      </main>

      <aside className="w-[360px] shrink-0 bg-surface border-l border-border flex flex-col">
        {/* ...unchanged cart panel content... */}
      </aside>
    </div>
```
to:
```tsx
    <div className="h-screen overflow-hidden flex flex-col bg-bg">
      <PageHeader title="Point of Sale" right={<LogoutButton />} />
      <div className="flex-1 flex min-h-0">
        <main className="flex-1 min-w-0 flex flex-col p-6 overflow-y-auto">
          {/* ...unchanged menu grid content... */}
        </main>

        <aside className="w-[360px] shrink-0 bg-surface border-l border-border flex flex-col">
          {/* ...unchanged cart panel content... */}
        </aside>
      </div>
    </div>
```
Everything inside `<main>` and `<aside>` (the category chips, item grid, order-type tabs, table select, cart lines, totals, submit button — all of it) stays byte-for-byte identical; only the outer wrapper gains a header and one extra `flex-1 flex min-h-0` wrapping div around the existing two panes.

- [ ] **Step 2: Run build to verify clean**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(staff)/pos/page.tsx"
git commit -m "feat: add header and logout button to staff POS page"
```

---

### Task 4: Add Logout to Kitchen Display Page

**Files:**
- Modify: `src/app/(staff)/kds/page.tsx`

**Interfaces:**
- Consumes: `LogoutButton` (Task 2), passed the `dark` variant to match `/kds`'s existing dark `PageHeader`.

- [ ] **Step 1: Add the import and wire the button in**

Add to the imports:
```tsx
import { LogoutButton } from '@/components/ui/LogoutButton';
```

Change:
```tsx
      <PageHeader title="Kitchen Display" subtitle="Kopi & Co · Live" dark />
```
to:
```tsx
      <PageHeader title="Kitchen Display" subtitle="Kopi & Co · Live" dark right={<LogoutButton dark />} />
```
Nothing else in this file changes — the `KdsOrder` type, the Ably `useEffect`, the ticket board, and every mutation call stay exactly as they are.

- [ ] **Step 2: Run build to verify clean**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(staff)/kds/page.tsx"
git commit -m "feat: add logout button to kitchen display header"
```

---

### Task 5: Add Logout to Admin Sidebar

**Files:**
- Modify: `src/app/(staff)/admin/layout.tsx`

**Interfaces:**
- Consumes: `LogoutButton` (Task 2).

The current sidebar has no "user chip" block (that only exists in the source design mockup, not in this shipped implementation) — this task adds a new bottom-pinned block containing just the logout control, using `mt-auto` on the `<aside>` (already `flex flex-col`) to push it to the bottom.

- [ ] **Step 1: Update the layout**

Add to the imports:
```tsx
import { LogoutButton } from '@/components/ui/LogoutButton';
```

Change the `<aside>` block from:
```tsx
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
```
to (identical except the added `mt-auto` block at the end):
```tsx
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
        <div className="mt-auto pt-3 px-2 border-t border-border">
          <LogoutButton />
        </div>
      </aside>
```

- [ ] **Step 2: Run build to verify clean**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(staff)/admin/layout.tsx"
git commit -m "feat: add logout link to admin sidebar"
```

---

### Task 6: Manual Verification Pass

**Files:**
- None (verification only — fix small bugs found here directly; report anything larger instead of expanding scope).

**Interfaces:**
- None new.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify the transition**

Log in with PIN `1234` at `/login`. Confirm the login card fades/slides out and `/pos` fades/slides in — no flash of unstyled content, no layout jump.

- [ ] **Step 3: Verify logout from all three surfaces**

- On `/pos`: click "Log out" in the new header. Confirm it navigates to `/login` with the same transition, and that a subsequent request to any staff/admin route without logging back in redirects or fails auth (session cookie should be gone).
- On `/kds`: click "Log out" in the header (light-on-dark styling should be legible against the dark KDS background). Confirm it returns to `/login`.
- On any `/admin/*` page: click "Log out" at the bottom of the sidebar. Confirm it returns to `/login`.

- [ ] **Step 4: Verify `/pos`'s layout still scroll-contains correctly**

With the seed menu (or more items if added later), confirm the menu grid and cart panel each scroll independently within the viewport-bounded shell — the header addition in Task 3 must not have reintroduced the "cart footer scrolls off-screen" bug fixed earlier in this project's history.

- [ ] **Step 5: Fix any small bugs found**

Fix directly if small and clearly scoped to this feature's own changes; report rather than expand scope if it reveals something unrelated.

- [ ] **Step 6: Final build check**

Run: `npm run build`
Expected: clean, same 12 routes as before this plan (this plan adds no new routes).

- [ ] **Step 7: Commit any fixes from Step 5**

```bash
git add -A
git commit -m "fix: address issues found during manual verification"
```

(Skip this step if Step 5 found nothing to fix.)

# Logout Flow & Page Transitions — Design

**Date**: 2026-08-16
**Status**: Approved (design), pending implementation plan

## Overview

Two related additions to the existing POS app: (1) a logout entry point, which does not exist anywhere in the UI today despite `auth.logout` already existing as a tRPC procedure, and (2) an animated page transition (fade + slight vertical slide) applied uniformly to every route change via Framer Motion, so login → `/pos` and logout → `/login` both transition smoothly as a natural consequence of the same mechanism.

## Scope

**In scope:**
- A shared `LogoutButton` component, calling `trpc.auth.logout.useMutation()` then `router.push('/login')`.
- Wiring `LogoutButton` into three places: `/pos`'s new header, `/kds`'s existing header, and the admin sidebar's user-chip block.
- Giving `/pos` a header for the first time, by reusing the existing `PageHeader` component (built in the earlier design-system refactor, currently only used on `/kds`).
- Adding `right={<LogoutButton />}` to `/kds`'s existing `PageHeader` usage.
- A small `LogoutButton` link added to the admin sidebar's existing user-chip area — no layout restructuring.
- Installing `motion` (the current npm package; successor to `framer-motion`, same maintainers) and adding a `PageTransition` client component wrapping `{children}` in the root layout via `AnimatePresence`.

**Out of scope:**
- Any change to what pages exist or what they do beyond adding the logout control and the header on `/pos`.
- Per-route-pair custom transition variants — one consistent fade+slide applies to all navigation, per the approved design.
- The separate "more menu items + generated images" request — tracked as its own follow-on feature with its own brainstorm/spec.

## Design

### Logout

A new `src/components/ui/LogoutButton.tsx`:
- Calls `trpc.auth.logout.useMutation({ onSuccess: () => router.push('/login') })`.
- Renders as a small text/link-style control (not a full `Button` primitive — it's a secondary action next to primary page content, styled to fit each of its three contexts: light `PageHeader` on `/pos`, dark `PageHeader` on `/kds`, and the admin sidebar's user chip).

Wiring:
- `src/app/(staff)/pos/page.tsx`: currently has no header at all. Add `<PageHeader title="Point of Sale" right={<LogoutButton />} />` above the existing two-pane layout.
- `src/app/(staff)/kds/page.tsx`: already renders `<PageHeader title="Kitchen Display" subtitle="Kopi & Co · Live" dark />` — add `right={<LogoutButton dark />}` (the button needs a `dark` variant/prop to read correctly against the KDS dark palette).
- `src/app/(staff)/admin/layout.tsx`: the sidebar's existing user-chip block (currently just a static avatar + name + role) gets a `LogoutButton` appended below it.

### Page transitions

- Install `motion`.
- New `src/components/PageTransition.tsx` (client component):
  ```tsx
  'use client';
  import { AnimatePresence, motion } from 'motion/react';
  import { usePathname } from 'next/navigation';

  const variants = {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -16 },
  };

  export function PageTransition({ children }: { children: React.ReactNode }) {
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
- `src/app/layout.tsx`: wrap `{children}` (inside the existing `TrpcProvider`, keeping current structure otherwise unchanged) with `<PageTransition>{children}</PageTransition>`.

This animates every route change app-wide (a deliberate, approved choice — App Router's standard AnimatePresence pattern can't cheaply be scoped to only two specific route pairs), which naturally covers login → `/pos` on login success and any staff page → `/login` on logout, without any special-casing in the login or logout logic themselves.

## Testing

No automated tests (pure UI/animation, consistent with how the rest of this app's frontend has been verified). Manual verification: log in, confirm the login card transitions out and `/pos` transitions in; click logout from `/pos`, `/kds`, and the admin sidebar, confirm each returns to `/login` with the same transition; confirm `npm run build` stays clean.

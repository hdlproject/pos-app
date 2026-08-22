'use client';
import { motion } from 'motion/react';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

// Enter-only fade (no AnimatePresence/exit stage): mode="wait" forced the
// old page to fully animate out before the new one started, leaving a
// blank gap and doubling the perceived duration on every navigation --
// felt laggy, especially switching between admin tabs. A pure fade-in on
// mount is snappier and doesn't fight page-to-page height differences the
// way the old vertical slide did.
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    // Note: this wraps every nested layout too (e.g. AdminLayout), so any
    // future layout-level state (scroll position, collapsed sections, etc.)
    // will reset on every navigation, not just full page loads. Accepted
    // trade-off of animating uniformly across all routes without special-casing.
    <motion.div
      key={pathname}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

'use client';
import { motion } from 'motion/react';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

// Fires only when crossing the login boundary (landing on /login, or
// leaving it after a successful login) -- keyed on that boolean rather
// than the full pathname, so ordinary in-app navigation (switching admin
// tabs, POS/KDS, etc.) doesn't remount this wrapper and never animates.
// Previously keyed by pathname, which re-triggered the fade on every
// single navigation and felt like constant motion.
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === '/login';
  return (
    <motion.div
      key={isLogin ? 'login' : 'app'}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

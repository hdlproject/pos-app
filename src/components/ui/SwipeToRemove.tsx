'use client';
import { motion, useMotionValue, useTransform, animate } from 'motion/react';
import type { ReactNode } from 'react';

const REMOVE_THRESHOLD = -140;
const DRAG_LIMIT = -240;

// Wraps a cart row so it can be swiped left to remove. Drags freely with
// elastic resistance past the limit; releasing past REMOVE_THRESHOLD
// animates the row off-screen and removes it. Anything short of that
// bounces back to rest with a springy overshoot rather than parking open
// -- no separate X button, no persistent "revealed" state to dismiss.
export function SwipeToRemove({
  children,
  onRemove,
  rowClassName = 'bg-surface',
}: {
  children: ReactNode;
  onRemove: () => void;
  rowClassName?: string;
}) {
  const x = useMotionValue(0);
  const bgOpacity = useTransform(x, [-100, -10], [1, 0]);

  function handleDragEnd() {
    if (x.get() < REMOVE_THRESHOLD) {
      animate(x, -400, { duration: 0.2, ease: 'easeIn', onComplete: onRemove });
    } else {
      animate(x, 0, { type: 'spring', stiffness: 300, damping: 16 });
    }
  }

  return (
    <div className="relative overflow-hidden rounded-xl">
      <motion.div
        style={{ opacity: bgOpacity }}
        className="absolute inset-0 bg-warning flex items-center justify-end px-4"
      >
        <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" />
        </svg>
      </motion.div>
      <motion.div
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: DRAG_LIMIT, right: 0 }}
        dragElastic={{ left: 0.3, right: 0 }}
        style={{ x, touchAction: 'pan-y' }}
        onDragEnd={handleDragEnd}
        className={`relative ${rowClassName}`}
      >
        {children}
      </motion.div>
    </div>
  );
}

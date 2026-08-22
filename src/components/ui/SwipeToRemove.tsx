'use client';
import { useState } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'motion/react';
import type { ReactNode } from 'react';

const REVEAL_X = -80;
const REVEAL_THRESHOLD = -40;
const REMOVE_THRESHOLD = -160;
const DRAG_LIMIT = -240;

// Wraps a cart row in a two-stage swipe-to-remove. First swipe past
// REVEAL_THRESHOLD snaps the row open to REVEAL_X, parking the bin icon
// fully visible. From there either a further swipe past REMOVE_THRESHOLD
// or a tap on the bin icon removes the row; swiping back closes it. This
// is the sole removal affordance for cart rows -- no separate X button.
export function SwipeToRemove({
  children,
  onRemove,
  rowClassName = 'bg-surface',
}: {
  children: ReactNode;
  onRemove: () => void;
  rowClassName?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const x = useMotionValue(0);
  const bgOpacity = useTransform(x, [-40, -10], [1, 0]);

  function remove() {
    animate(x, -400, { duration: 0.2, ease: 'easeIn', onComplete: onRemove });
  }

  function handleDragEnd() {
    const current = x.get();
    if (current < REMOVE_THRESHOLD) {
      remove();
    } else if (current < REVEAL_THRESHOLD) {
      setRevealed(true);
      animate(x, REVEAL_X, { type: 'spring', stiffness: 500, damping: 40 });
    } else {
      setRevealed(false);
      animate(x, 0, { type: 'spring', stiffness: 500, damping: 40 });
    }
  }

  return (
    <div className="relative overflow-hidden rounded-xl">
      <motion.div
        style={{ opacity: bgOpacity }}
        onClick={revealed ? remove : undefined}
        className={`absolute inset-0 bg-warning flex items-center justify-end px-4 ${revealed ? 'cursor-pointer' : ''}`}
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

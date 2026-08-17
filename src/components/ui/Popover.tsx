'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';

type PopoverProps = {
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode;
  panelClassName?: string;
  // Optional controlled mode -- lets a caller close the panel itself (e.g.
  // after a successful Enter-to-submit), which the render-prop `toggle`
  // alone can't do. Omit both for the original uncontrolled behavior.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function Popover({ trigger, children, panelClassName = '', open: openProp, onOpenChange }: PopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const containerRef = useRef<HTMLDivElement>(null);
  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenRef.current(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      {trigger({ open, toggle: () => setOpen(!open) })}
      {open && (
        <div
          className={`absolute z-20 top-full mt-2 right-0 bg-surface border border-border rounded-xl shadow-lg p-3 w-[min(240px,calc(100vw-2rem))] ${panelClassName}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

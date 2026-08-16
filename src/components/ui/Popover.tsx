'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';

type PopoverProps = {
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode;
  panelClassName?: string;
};

export function Popover({ trigger, children, panelClassName = '' }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
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

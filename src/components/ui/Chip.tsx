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

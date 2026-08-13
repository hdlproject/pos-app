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

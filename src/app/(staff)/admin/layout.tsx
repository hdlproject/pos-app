'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogoutButton } from '@/components/ui/LogoutButton';

const NAV = [
  { href: '/admin/menu', label: 'Menu' },
  { href: '/admin/ingredients', label: 'Ingredients' },
  { href: '/admin/tables', label: 'Tables' },
  { href: '/admin/reports', label: 'Reports' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-bg">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-[230px] md:shrink-0 bg-surface md:border-r border-border flex-col p-3.5 md:sticky md:top-0 md:h-screen">
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

      {/* Mobile top bar */}
      <div className="md:hidden flex items-center justify-between px-3.5 py-3 bg-surface border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center text-white font-display text-xl leading-none">
            K
          </div>
          <div className="leading-tight">
            <div className="font-display text-base text-text">Kopi &amp; Co</div>
            <div className="text-[10.5px] uppercase tracking-widest text-text-muted font-bold">Admin</div>
          </div>
        </div>
        <LogoutButton />
      </div>

      <div className="flex-1 min-w-0 pb-20 md:pb-0">{children}</div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-surface border-t border-border flex items-center gap-1 p-2">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-1 text-center px-2 py-2 rounded-xl font-bold text-xs ${
                active ? 'bg-accent text-white' : 'text-text-muted-2'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

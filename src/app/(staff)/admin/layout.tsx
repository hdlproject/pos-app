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
      <aside className="w-full md:w-[230px] md:shrink-0 bg-surface border-b md:border-b-0 md:border-r border-border flex flex-col p-3.5 md:sticky md:top-0 md:h-screen">
        <div className="flex items-center gap-3 px-2 pb-3 md:pb-5">
          <div className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center text-white font-display text-xl leading-none">
            K
          </div>
          <div className="leading-tight">
            <div className="font-display text-base text-text">Kopi &amp; Co</div>
            <div className="text-[10.5px] uppercase tracking-widest text-text-muted font-bold">Admin</div>
          </div>
        </div>
        <nav className="flex flex-row md:flex-col gap-1 overflow-x-auto md:overflow-visible">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`shrink-0 md:shrink px-3 py-2.5 rounded-xl font-bold text-sm ${
                  active ? 'bg-accent text-white' : 'text-text-muted-2 hover:bg-surface-input'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-3 md:mt-auto pt-3 px-2 border-t border-border">
          <LogoutButton />
        </div>
      </aside>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

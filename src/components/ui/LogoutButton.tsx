// src/components/ui/LogoutButton.tsx
'use client';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc-client';

type LogoutButtonProps = {
  dark?: boolean;
};

export function LogoutButton({ dark = false }: LogoutButtonProps) {
  const router = useRouter();
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => router.push('/login'),
  });

  return (
    <button
      onClick={() => logout.mutate()}
      disabled={logout.isPending}
      className={`text-xs font-bold px-3 py-2 rounded-lg transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-offset-1 ${
        dark
          ? 'text-kds-text-muted hover:bg-kds-card-header focus-visible:ring-status-ready focus-visible:ring-offset-kds-bg'
          : 'text-text-muted-2 hover:bg-surface-input focus-visible:ring-accent'
      }`}
    >
      Log out
    </button>
  );
}

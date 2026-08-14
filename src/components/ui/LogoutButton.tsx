'use client';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc-client';

type LogoutButtonProps = {
  dark?: boolean;
};

export function LogoutButton({ dark = false }: LogoutButtonProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const logout = trpc.auth.logout.useMutation({
    onSettled: () => {
      // clear() removes cached data outright (invalidateQueries only marks
      // it stale and would still serve it synchronously on remount, e.g.
      // via the browser Back button) so a shared terminal can't re-expose
      // the previous user's data after logout.
      queryClient.clear();
      router.replace('/login');
    },
  });

  return (
    <button
      onClick={() => logout.mutate()}
      disabled={logout.isPending}
      className={`text-xs font-bold px-3 py-2 rounded-lg transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-offset-1 ${
        dark
          ? 'text-kds-text-muted hover:bg-kds-card-header focus-visible:ring-status-ready focus-visible:ring-offset-kds-header'
          : 'text-text-muted-2 hover:bg-surface-input focus-visible:ring-accent'
      }`}
    >
      Log out
    </button>
  );
}

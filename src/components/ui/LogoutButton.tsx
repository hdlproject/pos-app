'use client';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc-client';

type LogoutButtonProps = {
  dark?: boolean;
  // Called before logging out; return/resolve false to abort. Lets a page
  // gate logout on its own state (e.g. an in-progress cart) with its own
  // confirmation UI, without LogoutButton needing to know what that state is.
  onBeforeLogout?: () => boolean | Promise<boolean>;
};

export function LogoutButton({ dark = false, onBeforeLogout }: LogoutButtonProps) {
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

  async function handleClick() {
    if (onBeforeLogout && !(await onBeforeLogout())) return;
    logout.mutate();
  }

  return (
    <button
      onClick={handleClick}
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

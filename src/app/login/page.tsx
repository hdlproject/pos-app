'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';

export default function LoginPage() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();
  const login = trpc.auth.login.useMutation({
    onSuccess: (data) => router.push(landingPathForRole(data.role)),
    onError: () => setError('Invalid PIN'),
  });

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="w-full max-w-xs bg-surface border border-border rounded-2xl p-8 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-accent flex items-center justify-center text-white font-display text-3xl leading-none mb-4">
          K
        </div>
        <h1 className="font-display text-2xl text-text mb-1">Kopi &amp; Co</h1>
        <p className="text-text-muted text-sm font-semibold mb-6">Staff login</p>
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN"
          className="w-full text-center text-2xl font-extrabold tracking-[0.3em] px-4 py-3 border border-border-strong rounded-xl bg-surface-input text-text outline-none focus-visible:ring-2 focus-visible:ring-accent mb-4"
        />
        <Button variant="primary" className="w-full" onClick={() => login.mutate({ pin })} disabled={login.isPending}>
          Login
        </Button>
        {error && (
          <p role="alert" className="text-warning text-sm font-semibold mt-3">
            {error}
          </p>
        )}

        <div className="mt-6 pt-5 border-t border-border">
          <p className="text-text-muted text-xs font-bold mb-2.5">Demo login</p>
          <div className="grid grid-cols-3 gap-2">
            {DEMO_LOGINS.map((demo) => (
              <Button
                key={demo.role}
                variant="outline"
                size="sm"
                onClick={() => login.mutate({ pin: demo.pin })}
                disabled={login.isPending}
              >
                {demo.role}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

const DEMO_LOGINS = [
  { role: 'Admin', pin: '1234' },
  { role: 'Staff', pin: '2345' },
  { role: 'Kitchen', pin: '4567' },
];

function landingPathForRole(role: string): string {
  if (role === 'KITCHEN') return '/kds';
  if (role === 'ADMIN') return '/admin/menu';
  return '/pos';
}

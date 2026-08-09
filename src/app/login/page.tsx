'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc-client';

export default function LoginPage() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();
  const login = trpc.auth.login.useMutation({
    onSuccess: () => router.push('/pos'),
    onError: () => setError('Invalid PIN'),
  });

  return (
    <main>
      <h1>Staff Login</h1>
      <input
        type="password"
        inputMode="numeric"
        maxLength={6}
        value={pin}
        onChange={(e) => setPin(e.target.value)}
      />
      <button onClick={() => login.mutate({ pin })} disabled={login.isPending}>
        Login
      </button>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}

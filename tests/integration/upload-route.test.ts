import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/server/db';
import { resetDb } from '../helpers/db';
import { hashPin } from '@/server/auth/pin';
import { signSession } from '@/server/auth/session';

// Same in-memory cookie-jar mock used by tests/integration/auth-router.test.ts —
// createContext() calls next/headers' cookies(), which throws outside a real
// request scope. This provides somewhere for a session cookie to live so the
// route handler's createContext() call can read it back.
vi.mock('next/headers', () => {
  const store = new Map<string, string>();
  return {
    cookies: async () => ({
      get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
      set: (name: string, value: string) => {
        store.set(name, value);
      },
      delete: (name: string) => {
        store.delete(name);
      },
    }),
  };
});

import { cookies } from 'next/headers';
import { POST } from '@/app/api/upload/route';

function pngFile(sizeBytes: number, name = 'photo.png'): File {
  return new File([new Uint8Array(sizeBytes)], name, { type: 'image/png' });
}

async function loginAs(role: 'ADMIN' | 'STAFF' | 'KITCHEN') {
  const user = await db.user.create({
    data: { name: role, role, pinHash: await hashPin('1234') },
  });
  const token = signSession({ userId: user.id, role: user.role, name: user.name });
  (await cookies()).set('session', token);
}

describe('upload route', () => {
  beforeEach(resetDb);

  it('uploads a valid image as ADMIN', async () => {
    await loginAs('ADMIN');
    const form = new FormData();
    form.append('file', pngFile(1024));
    const res = await POST(new Request('http://localhost/api/upload', { method: 'POST', body: form }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.url).toMatch(/^http/);
  });

  it('rejects a non-admin STAFF user', async () => {
    await loginAs('STAFF');
    const form = new FormData();
    form.append('file', pngFile(1024));
    const res = await POST(new Request('http://localhost/api/upload', { method: 'POST', body: form }));
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    const form = new FormData();
    form.append('file', pngFile(1024));
    const res = await POST(new Request('http://localhost/api/upload', { method: 'POST', body: form }));
    expect(res.status).toBe(401);
  });

  it('rejects a file over the 5MB limit', async () => {
    await loginAs('ADMIN');
    const form = new FormData();
    form.append('file', pngFile(5 * 1024 * 1024 + 1));
    const res = await POST(new Request('http://localhost/api/upload', { method: 'POST', body: form }));
    expect(res.status).toBe(400);
  });

  it('rejects a non-image content type', async () => {
    await loginAs('ADMIN');
    const form = new FormData();
    form.append('file', new File([new Uint8Array(10)], 'notes.txt', { type: 'text/plain' }));
    const res = await POST(new Request('http://localhost/api/upload', { method: 'POST', body: form }));
    expect(res.status).toBe(400);
  });
});

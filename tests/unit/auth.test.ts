import { describe, it, expect } from 'vitest';
import { hashPin, verifyPin } from '@/server/auth/pin';
import { signSession, verifySession } from '@/server/auth/session';

describe('pin hashing', () => {
  it('verifies a correct PIN and rejects a wrong one', async () => {
    const hash = await hashPin('1234');
    expect(await verifyPin('1234', hash)).toBe(true);
    expect(await verifyPin('9999', hash)).toBe(false);
  });

  it('produces a pbkdf2-formatted hash, not a bcrypt one', async () => {
    const hash = await hashPin('1234');
    expect(hash).toMatch(/^pbkdf2\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it('rejects a malformed or foreign hash instead of throwing', async () => {
    await expect(verifyPin('1234', 'not-a-real-hash')).resolves.toBe(false);
    await expect(verifyPin('1234', '$2b$10$notarealbcryptash')).resolves.toBe(false);
  });
});

describe('session tokens', () => {
  it('round-trips a signed session', async () => {
    const token = signSession({ userId: 'u1', role: 'ADMIN', name: 'Admin' });
    const payload = await verifySession(token);
    expect(payload).toMatchObject({ userId: 'u1', role: 'ADMIN', name: 'Admin' });
  });

  it('rejects a tampered token', async () => {
    const token = signSession({ userId: 'u1', role: 'ADMIN', name: 'Admin' });
    const payload = await verifySession(token + 'x');
    expect(payload).toBeNull();
  });
});

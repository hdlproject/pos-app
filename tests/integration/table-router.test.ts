import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';

describe('table router', () => {
  beforeEach(resetDb);

  it('creates a table with a token and rotates it', async () => {
    const admin = appRouter.createCaller({ db, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const table = await admin.table.create({ label: 'T1' });
    expect(table.qrToken).toHaveLength(24);

    const rotated = await admin.table.rotateToken({ id: table.id });
    expect(rotated.qrToken).not.toBe(table.qrToken);
  });
});

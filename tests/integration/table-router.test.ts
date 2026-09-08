import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { kdb } from '@/server/db.kysely';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';

describe('table router', () => {
  beforeEach(resetDb);

  it('creates a table with a token', async () => {
    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const table = await admin.table.create({ label: 'T1' });
    expect(table.qrToken).toHaveLength(24);
  });

  it('rejects creating a table with a duplicate label', async () => {
    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    await admin.table.create({ label: 'T1' });

    await expect(admin.table.create({ label: 'T1' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('renames a table', async () => {
    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const table = await admin.table.create({ label: 'T1' });

    const renamed = await admin.table.rename({ id: table.id, label: 'T1-renamed' });

    expect(renamed.label).toBe('T1-renamed');
    expect(renamed.qrToken).toBe(table.qrToken);
  });

  it('rejects renaming a table to an already-used label', async () => {
    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const t1 = await admin.table.create({ label: 'T1' });
    await admin.table.create({ label: 'T2' });

    await expect(admin.table.rename({ id: t1.id, label: 'T2' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

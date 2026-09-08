import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { createId } from '@/server/id';
import { resetDb } from '../helpers/db';

describe('db client', () => {
  beforeEach(resetDb);

  it('creates and reads a Category', async () => {
    const category = await db.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const found = await db.selectFrom('Category').selectAll().where('id', '=', category.id).executeTakeFirst();
    expect(found?.name).toBe('Coffee');
  });

  // Regression test for the timestamp round-trip bug: all 7 timestamp
  // columns in the schema are `timestamp(3) without time zone`. Without the
  // custom type parser in buildDb() (see src/server/db.ts),
  // postgres.js's default OID-1114 parser reads the naive datetime string
  // back as LOCAL time even though it was written as a UTC instant via
  // `toISOString()` -- so on any non-UTC host the read-back value is off by
  // the host's UTC offset. This must round-trip to the exact millisecond.
  it('round-trips a timestamp column through the exact millisecond, regardless of host timezone', async () => {
    const written = new Date('2026-09-07T12:34:56.789Z');
    const user = await db
      .insertInto('User')
      .values({ id: createId(), name: 'TZ Test', pinHash: 'x', role: 'ADMIN', createdAt: written })
      .returningAll()
      .executeTakeFirstOrThrow();

    const found = await db.selectFrom('User').selectAll().where('id', '=', user.id).executeTakeFirstOrThrow();

    expect(found.createdAt).toBeInstanceOf(Date);
    expect(found.createdAt.getTime()).toBe(written.getTime());
  });
});

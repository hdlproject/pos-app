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
});

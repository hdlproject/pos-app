import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { resetDb } from '../helpers/db';

describe('db client', () => {
  beforeEach(resetDb);

  it('creates and reads a Category', async () => {
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const found = await db.category.findUnique({ where: { id: category.id } });
    expect(found?.name).toBe('Coffee');
  });
});

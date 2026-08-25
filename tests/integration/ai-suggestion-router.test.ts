import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/server/db';
import { redis } from '@/server/redis';
import { resetDb } from '../helpers/db';

vi.mock('@/server/ai/openaiClient', () => ({
  fetchChatCompletion: vi.fn(),
}));

import { fetchChatCompletion } from '@/server/ai/openaiClient';
import { appRouter } from '@/server/trpc/routers/_app';

const mockedFetch = vi.mocked(fetchChatCompletion);

describe('aiSuggestion router', () => {
  beforeEach(async () => {
    await resetDb();
    await redis.flushdb();
    mockedFetch.mockReset();
  });

  it('returns validated suggestions built from the available menu', async () => {
    const table = await db.table.create({ data: { label: 'T1', qrToken: 'tok-1' } });
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const item = await db.menuItem.create({
      data: { name: 'Latte', price: 28000, categoryId: category.id, available: true },
    });
    await db.menuItem.create({
      data: { name: 'Hidden', price: 10000, categoryId: category.id, available: false },
    });
    mockedFetch.mockResolvedValue(
      JSON.stringify({ suggestions: [{ menuItemId: item.id, reason: 'Sweet and creamy' }] })
    );

    const anon = appRouter.createCaller({ db, user: null });
    const result = await anon.aiSuggestion.getSuggestion({
      tableToken: table.qrToken,
      taste: ['Sweet'],
      aroma: [],
      texture: ['Creamy'],
      type: ['Coffee'],
    });

    expect(result.suggestions).toEqual([
      {
        menuItemId: item.id,
        name: 'Latte',
        price: '28000',
        image: null,
        categoryName: 'Coffee',
        reason: 'Sweet and creamy',
      },
    ]);
    // the unavailable "Hidden" item must never reach the prompt
    const promptText = mockedFetch.mock.calls[0][0].map((m) => m.content).join('\n');
    expect(promptText).not.toContain('Hidden');
  });

  it('rejects an invalid table token', async () => {
    const anon = appRouter.createCaller({ db, user: null });
    await expect(
      anon.aiSuggestion.getSuggestion({ tableToken: 'not-a-real-token', taste: [], aroma: [], texture: [], type: [] })
    ).rejects.toThrow();
  });

  it('enforces the per-table cooldown on a second immediate request', async () => {
    const table = await db.table.create({ data: { label: 'T2', qrToken: 'tok-2' } });
    const category = await db.category.create({ data: { name: 'Tea', sortOrder: 1 } });
    await db.menuItem.create({ data: { name: 'Chamomile', price: 17000, categoryId: category.id, available: true } });
    mockedFetch.mockResolvedValue(JSON.stringify({ suggestions: [] }));

    const anon = appRouter.createCaller({ db, user: null });
    const input = { tableToken: table.qrToken, taste: [], aroma: [], texture: [], type: [] };
    await anon.aiSuggestion.getSuggestion(input);
    await expect(anon.aiSuggestion.getSuggestion(input)).rejects.toThrow();
  });

  it('returns no suggestions without calling OpenAI when the menu is empty', async () => {
    const table = await db.table.create({ data: { label: 'T3', qrToken: 'tok-3' } });
    const anon = appRouter.createCaller({ db, user: null });
    const result = await anon.aiSuggestion.getSuggestion({
      tableToken: table.qrToken,
      taste: [],
      aroma: [],
      texture: [],
      type: [],
    });
    expect(result.suggestions).toEqual([]);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('surfaces a clear error when the AI call fails', async () => {
    const table = await db.table.create({ data: { label: 'T4', qrToken: 'tok-4' } });
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    await db.menuItem.create({ data: { name: 'Latte', price: 28000, categoryId: category.id, available: true } });
    mockedFetch.mockRejectedValue(new Error('network down'));

    const anon = appRouter.createCaller({ db, user: null });
    await expect(
      anon.aiSuggestion.getSuggestion({ tableToken: table.qrToken, taste: [], aroma: [], texture: [], type: [] })
    ).rejects.toThrow(/couldn.t get suggestions/i);
  });
});

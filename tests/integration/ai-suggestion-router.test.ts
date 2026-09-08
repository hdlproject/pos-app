import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/server/db';
import { kdb } from '@/server/db.kysely';
import { createId } from '@/server/id';
import { redis } from '@/server/redis';
import { RedisCooldownStore } from '@/server/cooldownStore';
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
    const table = await kdb.insertInto('Table').values({ id: createId(), label: 'T1', qrToken: 'tok-1' }).returningAll().executeTakeFirstOrThrow();
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const item = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 28000, categoryId: category.id, available: true }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Hidden', price: 10000, categoryId: category.id, available: false }).execute();
    mockedFetch.mockResolvedValue(
      JSON.stringify({ suggestions: [{ menuItemId: item.id, name: 'Latte', reason: 'Sweet and creamy' }] })
    );

    const anon = appRouter.createCaller({ db, kdb, user: null, cooldownStore: new RedisCooldownStore() });
    const result = await anon.aiSuggestion.getSuggestion({
      tableToken: table.qrToken,
      requests: [{ type: 'Coffee', taste: ['Sweet'], aroma: [], texture: ['Creamy'] }],
    });

    expect(result.results).toEqual([
      {
        type: 'Coffee',
        suggestions: [
          {
            menuItemId: item.id,
            name: 'Latte',
            price: '28000',
            image: null,
            categoryName: 'Coffee',
            reason: 'Sweet and creamy',
          },
        ],
      },
    ]);
    // the unavailable "Hidden" item must never reach the prompt
    const promptText = mockedFetch.mock.calls[0][0].map((m) => m.content).join('\n');
    expect(promptText).not.toContain('Hidden');
  });

  it('sends every request in the batch together and preserves result order', async () => {
    const table = await kdb.insertInto('Table').values({ id: createId(), label: 'T-bulk', qrToken: 'tok-bulk' }).returningAll().executeTakeFirstOrThrow();
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const latte = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 28000, categoryId: category.id, available: true }).returningAll().executeTakeFirstOrThrow();
    const tea = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Chamomile', price: 17000, categoryId: category.id, available: true }).returningAll().executeTakeFirstOrThrow();
    mockedFetch
      .mockResolvedValueOnce(JSON.stringify({ suggestions: [{ menuItemId: latte.id, name: 'Latte', reason: 'Bold' }] }))
      .mockResolvedValueOnce(
        JSON.stringify({ suggestions: [{ menuItemId: tea.id, name: 'Chamomile', reason: 'Soothing' }] })
      );

    const anon = appRouter.createCaller({ db, kdb, user: null, cooldownStore: new RedisCooldownStore() });
    const result = await anon.aiSuggestion.getSuggestion({
      tableToken: table.qrToken,
      requests: [
        { type: 'Coffee', taste: [], aroma: [], texture: [] },
        { type: 'Tea', taste: [], aroma: [], texture: [] },
      ],
    });

    // one OpenAI call per request, dispatched together (not gated behind
    // each other resolving first) -- Promise.all, not sequential awaits.
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(result.results).toEqual([
      { type: 'Coffee', suggestions: [expect.objectContaining({ menuItemId: latte.id })] },
      { type: 'Tea', suggestions: [expect.objectContaining({ menuItemId: tea.id })] },
    ]);
  });

  it('rejects an empty requests array', async () => {
    const table = await kdb.insertInto('Table').values({ id: createId(), label: 'T-empty', qrToken: 'tok-empty' }).returningAll().executeTakeFirstOrThrow();
    const anon = appRouter.createCaller({ db, kdb, user: null, cooldownStore: new RedisCooldownStore() });
    await expect(
      anon.aiSuggestion.getSuggestion({ tableToken: table.qrToken, requests: [] })
    ).rejects.toThrow();
  });

  it('rejects an invalid table token', async () => {
    const anon = appRouter.createCaller({ db, kdb, user: null, cooldownStore: new RedisCooldownStore() });
    await expect(
      anon.aiSuggestion.getSuggestion({
        tableToken: 'not-a-real-token',
        requests: [{ type: 'Coffee', taste: [], aroma: [], texture: [] }],
      })
    ).rejects.toThrow();
  });

  it('enforces the per-table cooldown on a second immediate request, even across a whole batch', async () => {
    const table = await kdb.insertInto('Table').values({ id: createId(), label: 'T2', qrToken: 'tok-2' }).returningAll().executeTakeFirstOrThrow();
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Tea', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Chamomile', price: 17000, categoryId: category.id, available: true }).execute();
    mockedFetch.mockResolvedValue(JSON.stringify({ suggestions: [] }));

    const anon = appRouter.createCaller({ db, kdb, user: null, cooldownStore: new RedisCooldownStore() });
    const input = { tableToken: table.qrToken, requests: [{ type: 'Tea', taste: [], aroma: [], texture: [] }] };
    await anon.aiSuggestion.getSuggestion(input);
    await expect(anon.aiSuggestion.getSuggestion(input)).rejects.toThrow();
  });

  it('returns no suggestions without calling OpenAI when the menu is empty', async () => {
    const table = await kdb.insertInto('Table').values({ id: createId(), label: 'T3', qrToken: 'tok-3' }).returningAll().executeTakeFirstOrThrow();
    const anon = appRouter.createCaller({ db, kdb, user: null, cooldownStore: new RedisCooldownStore() });
    const result = await anon.aiSuggestion.getSuggestion({
      tableToken: table.qrToken,
      requests: [{ type: 'Coffee', taste: [], aroma: [], texture: [] }],
    });
    expect(result.results).toEqual([{ type: 'Coffee', suggestions: [] }]);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('surfaces a clear error when any request in the batch fails', async () => {
    const table = await kdb.insertInto('Table').values({ id: createId(), label: 'T4', qrToken: 'tok-4' }).returningAll().executeTakeFirstOrThrow();
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 28000, categoryId: category.id, available: true }).execute();
    mockedFetch.mockRejectedValue(new Error('network down'));

    const anon = appRouter.createCaller({ db, kdb, user: null, cooldownStore: new RedisCooldownStore() });
    await expect(
      anon.aiSuggestion.getSuggestion({
        tableToken: table.qrToken,
        requests: [{ type: 'Coffee', taste: [], aroma: [], texture: [] }],
      })
    ).rejects.toThrow(/couldn.t get suggestions/i);
  });
});

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { TASTE_OPTIONS, AROMA_OPTIONS, TEXTURE_OPTIONS } from '../../../lib/suggestionOptions';
import { buildSuggestionMessages, parseSuggestionResponse, SuggestionParseError } from '../../ai/suggestion';
import { fetchChatCompletion } from '../../ai/openaiClient';

const requestInput = z.object({
  type: z.string().min(1).max(60),
  taste: z.array(z.enum(TASTE_OPTIONS)).max(TASTE_OPTIONS.length),
  aroma: z.array(z.enum(AROMA_OPTIONS)).max(AROMA_OPTIONS.length),
  texture: z.array(z.enum(TEXTURE_OPTIONS)).max(TEXTURE_OPTIONS.length),
  notes: z.string().max(200).optional(),
});

// One or more per-type requests, submitted together as a single bulk call --
// all of them share one cooldown check rather than each burning its own,
// which is what firing N separate publicProcedure calls concurrently for
// the same tableToken would otherwise race against (the cooldown key is
// per table, not per type).
const suggestionInput = z.object({
  tableToken: z.string(),
  requests: z.array(requestInput).min(1).max(10),
});

const COOLDOWN_SECONDS = 30;

function cooldownKey(tableToken: string): string {
  return `ai-suggest-cooldown:${tableToken}`;
}

type SuggestionCard = {
  menuItemId: string;
  name: string;
  price: string;
  image: string | null;
  categoryName: string;
  reason: string;
};

export const aiSuggestionRouter = router({
  getSuggestion: publicProcedure.input(suggestionInput).mutation(async ({ ctx, input }) => {
    const cooldownStore = ctx.cooldownStore;
    if (!cooldownStore) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'cooldown store not configured' });
    }
    const kdb = ctx.db;

    const table = await kdb.selectFrom('Table').selectAll().where('qrToken', '=', input.tableToken).executeTakeFirst();
    if (!table) throw new TRPCError({ code: 'NOT_FOUND', message: 'invalid table token' });

    const allowed = await cooldownStore.checkAndSet(cooldownKey(input.tableToken), COOLDOWN_SECONDS);
    if (!allowed) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: 'Please wait a moment before requesting more suggestions.',
      });
    }

    const rows = await kdb
      .selectFrom('MenuItem')
      .innerJoin('Category', 'Category.id', 'MenuItem.categoryId')
      .select(['MenuItem.id as id', 'MenuItem.name as name', 'MenuItem.price as price', 'MenuItem.image as image', 'Category.name as categoryName'])
      .where('MenuItem.available', '=', true)
      .where('MenuItem.outOfStockReason', 'is', null)
      .execute();

    if (rows.length === 0) {
      await cooldownStore.clear(cooldownKey(input.tableToken));
      return { results: input.requests.map((r) => ({ type: r.type, suggestions: [] as SuggestionCard[] })) };
    }

    const menuForAi = rows.map((i) => ({ id: i.id, name: i.name, category: i.categoryName, price: Number(i.price) }));
    const byId = new Map(rows.map((i) => [i.id, i]));

    try {
      // Every sub-request goes out at once (Promise.all), not one after
      // another -- "sent to AI at the same time" -- and any single failure
      // (network, malformed response) fails the whole batch the same way a
      // single-request failure always has, rather than returning partial
      // results the customer would have to sort out which page succeeded.
      const results = await Promise.all(
        input.requests.map(async (r) => {
          const messages = buildSuggestionMessages(
            { taste: r.taste, aroma: r.aroma, texture: r.texture, type: [r.type], notes: r.notes },
            menuForAi
          );
          const raw = await fetchChatCompletion(messages);
          const parsed = parseSuggestionResponse(raw, menuForAi);
          const suggestions = parsed
            .map((p): SuggestionCard | null => {
              const item = byId.get(p.menuItemId);
              if (!item) return null;
              return {
                menuItemId: item.id,
                name: item.name,
                price: String(Number(item.price)),
                image: item.image,
                categoryName: item.categoryName,
                reason: p.reason,
              };
            })
            .filter((s): s is SuggestionCard => s !== null);
          return { type: r.type, suggestions };
        })
      );
      return { results };
    } catch (err) {
      if (err instanceof SuggestionParseError) {
        console.error('OpenAI suggestion response malformed', err);
      } else {
        console.error('OpenAI suggestion call failed', err);
      }
      await cooldownStore.clear(cooldownKey(input.tableToken));
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: "Couldn't get suggestions, try again." });
    }
  }),
});

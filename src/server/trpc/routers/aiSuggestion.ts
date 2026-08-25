import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { TASTE_OPTIONS, AROMA_OPTIONS, TEXTURE_OPTIONS } from '../../../lib/suggestionOptions';
import { checkAndSetCooldown, clearCooldown } from '../../ai/cooldown';
import { buildSuggestionMessages, parseSuggestionResponse, SuggestionParseError } from '../../ai/suggestion';
import { fetchChatCompletion } from '../../ai/openaiClient';

const suggestionInput = z.object({
  tableToken: z.string(),
  taste: z.array(z.enum(TASTE_OPTIONS)).max(TASTE_OPTIONS.length),
  aroma: z.array(z.enum(AROMA_OPTIONS)).max(AROMA_OPTIONS.length),
  texture: z.array(z.enum(TEXTURE_OPTIONS)).max(TEXTURE_OPTIONS.length),
  type: z.array(z.string().max(60)).max(10),
  notes: z.string().max(200).optional(),
});

// Explicit flat row shape -- same TS2589 workaround as every other router
// here (see menu.ts's MenuItemWithCategory) for a Prisma query with a
// nested include.
type SuggestionMenuRow = {
  id: string;
  name: string;
  price: unknown;
  image: string | null;
  category: { name: string };
};

export const aiSuggestionRouter = router({
  getSuggestion: publicProcedure.input(suggestionInput).mutation(async ({ ctx, input }) => {
    const table = await ctx.db.table.findUnique({ where: { qrToken: input.tableToken } });
    if (!table) throw new TRPCError({ code: 'NOT_FOUND', message: 'invalid table token' });

    const allowed = await checkAndSetCooldown(input.tableToken);
    if (!allowed) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: 'Please wait a moment before requesting more suggestions.',
      });
    }

    const items = (await ctx.db.menuItem.findMany({
      where: { available: true, outOfStockReason: null },
      include: { category: true },
    })) as unknown as SuggestionMenuRow[];

    if (items.length === 0) {
      await clearCooldown(input.tableToken);
      return { suggestions: [] };
    }

    const menuForAi = items.map((i) => ({ id: i.id, name: i.name, category: i.category.name, price: Number(i.price) }));
    const messages = buildSuggestionMessages(
      { taste: input.taste, aroma: input.aroma, texture: input.texture, type: input.type, notes: input.notes },
      menuForAi
    );

    let raw: string;
    try {
      raw = await fetchChatCompletion(messages);
    } catch (err) {
      console.error('OpenAI suggestion call failed', err);
      await clearCooldown(input.tableToken);
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: "Couldn't get suggestions, try again." });
    }

    let parsed: ReturnType<typeof parseSuggestionResponse>;
    try {
      parsed = parseSuggestionResponse(raw, menuForAi);
    } catch (err) {
      if (err instanceof SuggestionParseError) {
        console.error('OpenAI suggestion response malformed', err);
        await clearCooldown(input.tableToken);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: "Couldn't get suggestions, try again." });
      }
      throw err;
    }

    const byId = new Map(items.map((i) => [i.id, i]));
    const suggestions = parsed
      .map((p) => {
        const item = byId.get(p.menuItemId);
        if (!item) return null;
        return {
          menuItemId: item.id,
          name: item.name,
          price: String(item.price),
          image: item.image,
          categoryName: item.category.name,
          reason: p.reason,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    return { suggestions };
  }),
});

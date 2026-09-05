import type { SuggestionMessage } from './suggestion';

export type BestSeller = { name: string; qtySold: number };
export type StockIngredient = { id: string; name: string; unit: string; stockQty: number };

export type MenuSuggestionContext = {
  bestSellers: BestSeller[];
  ingredients: StockIngredient[];
  existingItemNames: string[];
  cuisine: string[];
  taste: string[];
  aroma: string[];
  texture: string[];
  categoryHint?: string;
  notes?: string;
};

export type MenuSuggestionIngredientDraft = {
  name: string;
  unit: string;
  qtyPerUnit: number;
  existingIngredientId: string | null;
};

export type MenuSuggestionDraft = {
  name: string;
  price: number;
  category: string;
  description: string;
  instructions: string;
  ingredients: MenuSuggestionIngredientDraft[];
  reasoning: string;
};

export type MenuSuggestionResult = { ok: true; draft: MenuSuggestionDraft } | { ok: false; reason: string };

export class MenuSuggestionParseError extends Error {}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

// Defensive fallback for when the model ignores the "one step per line"
// instruction and returns numbered steps run together on one line -- if
// there's no newline already, insert one before every step marker after
// the first ("2. ", "3. ", ...) so it still renders as a readable list.
function formatInstructions(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes('\n')) return trimmed;
  return trimmed.replace(/\s*(\d+\.\s)/g, (match, marker: string, offset: number) => (offset === 0 ? marker : `\n${marker}`));
}

const SYSTEM_PROMPT =
  'You are a menu development assistant for a cafe/restaurant. Given recent best-selling items, ' +
  'current ingredient stock levels (lowest-stock ingredients listed first -- prioritize using these ' +
  'up before they run out or spoil), and the existing menu, propose ONE new menu item concept. ' +
  'Avoid duplicating an existing item. Prefer ingredients already in stock, especially the ' +
  'lowest-stock ones, but you may include an ingredient not currently in stock if the concept ' +
  'genuinely needs it. Respond with ONLY a JSON object of the exact shape ' +
  '{"name":"...","price":<integer IDR>,"category":"...","description":"<1-2 sentences>",' +
  '"instructions":"<step-by-step cooking instructions, numbered, ONE STEP PER LINE separated by ' +
  'literal \\n newline characters, e.g. \\"1. Cook the rice.\\n2. Season the chicken.\\n3. Combine ' +
  'and serve.\\" -- never put multiple numbered steps on the same line>",' +
  '"ingredients":[{"name":"...","unit":"...","qtyPerUnit":<number>}],' +
  '"reasoning":"<1-2 sentences tying this to the sales/stock data given>"}. ' +
  'If nothing sensible can be proposed from the given data, respond with ' +
  '{"error":"<short reason>"} instead of forcing a bad match.';

export function buildMenuSuggestionMessages(context: MenuSuggestionContext): SuggestionMessage[] {
  const bestSellerLines = context.bestSellers.length
    ? context.bestSellers.map((b) => `- ${b.name}: ${b.qtySold} sold`).join('\n')
    : '(no sales data available)';

  const ingredientLines = context.ingredients.length
    ? context.ingredients.map((i) => `- ${i.name} (${i.unit}): ${i.stockQty} in stock`).join('\n')
    : '(no ingredients in inventory)';

  const existingMenuLine = context.existingItemNames.length ? context.existingItemNames.join(', ') : '(menu is empty)';

  const steeringLines = [
    context.cuisine.length ? `Preferred cuisine: ${context.cuisine.join(', ')}` : null,
    context.categoryHint ? `Preferred category: ${context.categoryHint}` : null,
    context.taste.length ? `Preferred taste: ${context.taste.join(', ')}` : null,
    context.aroma.length ? `Preferred aroma: ${context.aroma.join(', ')}` : null,
    context.texture.length ? `Preferred texture: ${context.texture.join(', ')}` : null,
    context.notes ? `Notes: ${context.notes}` : null,
  ].filter((l): l is string => l !== null);

  const user =
    `Best-selling items (last 30 days):\n${bestSellerLines}\n\n` +
    `Current ingredient stock (lowest first):\n${ingredientLines}\n\n` +
    `Existing menu items (avoid near-duplicates):\n${existingMenuLine}\n\n` +
    (steeringLines.length ? `Admin preferences:\n${steeringLines.join('\n')}\n\n` : '') +
    `Propose one new menu item.`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

export function parseMenuSuggestionResponse(raw: string, knownIngredients: StockIngredient[]): MenuSuggestionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MenuSuggestionParseError('AI response was not valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new MenuSuggestionParseError('AI response was not a JSON object');
  }

  if (typeof (parsed as { error?: unknown }).error === 'string') {
    return { ok: false, reason: (parsed as { error: string }).error };
  }

  const p = parsed as Record<string, unknown>;
  if (
    typeof p.name !== 'string' ||
    p.name.trim().length === 0 ||
    typeof p.price !== 'number' ||
    !(p.price > 0) ||
    typeof p.category !== 'string' ||
    p.category.trim().length === 0 ||
    typeof p.description !== 'string' ||
    typeof p.instructions !== 'string' ||
    typeof p.reasoning !== 'string' ||
    !Array.isArray(p.ingredients) ||
    p.ingredients.length === 0
  ) {
    throw new MenuSuggestionParseError('AI response missing required fields');
  }

  const byName = new Map(knownIngredients.map((i) => [normalizeName(i.name), i]));
  const ingredients: MenuSuggestionIngredientDraft[] = [];
  const seenIngredientKeys = new Set<string>();
  for (const entry of p.ingredients) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as { name?: unknown }).name !== 'string' ||
      typeof (entry as { unit?: unknown }).unit !== 'string' ||
      typeof (entry as { qtyPerUnit?: unknown }).qtyPerUnit !== 'number' ||
      !((entry as { qtyPerUnit: number }).qtyPerUnit > 0)
    ) {
      throw new MenuSuggestionParseError('AI response has a malformed ingredient entry');
    }
    const e = entry as { name: string; unit: string; qtyPerUnit: number };
    const known = byName.get(normalizeName(e.name));
    const draft: MenuSuggestionIngredientDraft = known
      ? { name: known.name, unit: known.unit, qtyPerUnit: e.qtyPerUnit, existingIngredientId: known.id }
      : { name: e.name.trim(), unit: e.unit.trim(), qtyPerUnit: e.qtyPerUnit, existingIngredientId: null };

    const dedupKey = draft.existingIngredientId ?? normalizeName(draft.name);
    if (seenIngredientKeys.has(dedupKey)) continue;
    seenIngredientKeys.add(dedupKey);

    ingredients.push(draft);
  }

  return {
    ok: true,
    draft: {
      name: p.name.trim(),
      price: p.price,
      category: p.category.trim(),
      description: p.description.trim(),
      instructions: formatInstructions(p.instructions),
      ingredients,
      reasoning: p.reasoning.trim(),
    },
  };
}

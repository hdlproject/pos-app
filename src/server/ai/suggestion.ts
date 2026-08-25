export type SuggestionPreferences = {
  taste: string[];
  aroma: string[];
  texture: string[];
  type: string[];
  notes?: string;
};

export type SuggestionMenuItem = { id: string; name: string; category: string; price: number };
export type SuggestionResult = { menuItemId: string; reason: string };
export type SuggestionMessage = { role: 'system' | 'user'; content: string };

export class SuggestionParseError extends Error {}

const SYSTEM_PROMPT =
  'You are a menu recommendation assistant for a cafe. Given a customer\'s preferences and the ' +
  'current available menu, recommend up to 5 items that best match. Always recommend your best ' +
  'guesses even if the match is imperfect -- never return an empty list if the menu is non-empty. ' +
  'Respond with ONLY a JSON object of the exact shape ' +
  '{"suggestions":[{"menuItemId":"<id from the menu list>","reason":"<one short sentence>"}]}, ' +
  'using menuItemId values taken verbatim from the provided menu -- never invent an id.';

export function buildSuggestionMessages(
  preferences: SuggestionPreferences,
  menuItems: SuggestionMenuItem[]
): SuggestionMessage[] {
  const menuLines = menuItems.map((m) => `- id=${m.id} | ${m.name} | ${m.category} | Rp${m.price}`).join('\n');

  const prefLines = [
    preferences.taste.length ? `Taste: ${preferences.taste.join(', ')}` : null,
    preferences.aroma.length ? `Aroma: ${preferences.aroma.join(', ')}` : null,
    preferences.texture.length ? `Texture: ${preferences.texture.join(', ')}` : null,
    preferences.type.length ? `Type: ${preferences.type.join(', ')}` : null,
    preferences.notes ? `Notes: ${preferences.notes}` : null,
  ].filter((line): line is string => line !== null);

  const user =
    `Customer preferences:\n${prefLines.length ? prefLines.join('\n') : '(no specific preferences given)'}\n\n` +
    `Available menu:\n${menuLines}`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

export function parseSuggestionResponse(raw: string, menuItems: SuggestionMenuItem[]): SuggestionResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SuggestionParseError('AI response was not valid JSON');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { suggestions?: unknown }).suggestions)
  ) {
    throw new SuggestionParseError('AI response missing a suggestions array');
  }

  const validIds = new Set(menuItems.map((m) => m.id));
  const results: SuggestionResult[] = [];
  for (const entry of (parsed as { suggestions: unknown[] }).suggestions) {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { menuItemId?: unknown }).menuItemId === 'string' &&
      typeof (entry as { reason?: unknown }).reason === 'string' &&
      validIds.has((entry as { menuItemId: string }).menuItemId)
    ) {
      const e = entry as { menuItemId: string; reason: string };
      results.push({ menuItemId: e.menuItemId, reason: e.reason });
    }
  }
  return results.slice(0, 5);
}

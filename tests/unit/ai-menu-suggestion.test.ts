import { describe, it, expect } from 'vitest';
import {
  buildMenuSuggestionMessages,
  parseMenuSuggestionResponse,
  MenuSuggestionParseError,
  type StockIngredient,
} from '@/server/ai/menuSuggestion';

const ingredients: StockIngredient[] = [
  { id: 'i1', name: 'Rice', unit: 'g', stockQty: 200 },
  { id: 'i2', name: 'Chicken Breast', unit: 'g', stockQty: 50 },
];

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Dish',
    price: 10000,
    category: 'Food',
    description: 'd',
    instructions: 'i',
    ingredients: [{ name: 'Rice', unit: 'g', qtyPerUnit: 100 }],
    reasoning: 'r',
    ...overrides,
  };
}

describe('buildMenuSuggestionMessages', () => {
  it('includes best/worst sellers, ingredients, category counts, existing menu, and steering input', () => {
    const messages = buildMenuSuggestionMessages({
      bestSellers: [{ name: 'Latte', qtySold: 12 }],
      worstSellers: [{ name: 'Stale Muffin', qtySold: 1 }],
      ingredients,
      existingItemNames: ['Latte', 'Espresso'],
      categoryCounts: [{ name: 'Drinks', count: 5 }],
      cuisine: ['Korean'],
      taste: ['Sweet'],
      aroma: ['Roasted'],
      texture: ['Creamy'],
      categoryHint: 'Food',
      notes: 'use up chicken',
    });
    expect(messages[0].role).toBe('system');
    const user = messages[1].content;
    expect(user).toContain('Latte');
    expect(user).toContain('12 sold');
    expect(user).toContain('Stale Muffin');
    expect(user).toContain('1 sold');
    expect(user).toContain('Chicken Breast');
    expect(user).toContain('Drinks: 5 items');
    expect(user).toContain('Korean');
    expect(user).toContain('Sweet');
    expect(user).toContain('Roasted');
    expect(user).toContain('Creamy');
    expect(user).toContain('Food');
    expect(user).toContain('use up chicken');
  });

  it('handles no sellers, no categories, and no steering input without throwing', () => {
    const messages = buildMenuSuggestionMessages({
      bestSellers: [],
      worstSellers: [],
      ingredients,
      existingItemNames: [],
      categoryCounts: [],
      cuisine: [],
      taste: [],
      aroma: [],
      texture: [],
    });
    expect(messages).toHaveLength(2);
  });
});

describe('parseMenuSuggestionResponse', () => {
  it('parses valid candidates and tags an existing ingredient with its real id/unit', () => {
    const raw = JSON.stringify({
      candidates: [
        candidate({
          name: 'Chicken Bibimbap',
          price: 42000,
          category: 'Korean',
          description: 'A rice bowl with chicken and vegetables.',
          instructions: '1. Cook rice.\n2. Cook chicken.\n3. Assemble.',
          ingredients: [{ name: 'rice', unit: 'g', qtyPerUnit: 200 }],
          reasoning: 'Uses low-stock chicken and a popular rice base.',
        }),
      ],
    });
    const result = parseMenuSuggestionResponse(raw, ingredients);
    expect(result).toEqual({
      ok: true,
      candidates: [
        {
          name: 'Chicken Bibimbap',
          price: 42000,
          category: 'Korean',
          description: 'A rice bowl with chicken and vegetables.',
          instructions: '1. Cook rice.\n2. Cook chicken.\n3. Assemble.',
          ingredients: [{ name: 'Rice', unit: 'g', qtyPerUnit: 200, existingIngredientId: 'i1' }],
          reasoning: 'Uses low-stock chicken and a popular rice base.',
        },
      ],
    });
  });

  it('parses multiple candidates, up to 3', () => {
    const raw = JSON.stringify({
      candidates: [
        candidate({ name: 'A' }),
        candidate({ name: 'B' }),
        candidate({ name: 'C' }),
        candidate({ name: 'D' }),
      ],
    });
    const result = parseMenuSuggestionResponse(raw, ingredients);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidates).toHaveLength(3);
      expect(result.candidates.map((c) => c.name)).toEqual(['A', 'B', 'C']);
    }
  });

  it('drops a malformed candidate but keeps the valid ones', () => {
    const raw = JSON.stringify({
      candidates: [candidate({ name: 'Good' }), { name: 'Bad' }],
    });
    const result = parseMenuSuggestionResponse(raw, ingredients);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].name).toBe('Good');
    }
  });

  it('throws MenuSuggestionParseError when every candidate is malformed', () => {
    const raw = JSON.stringify({ candidates: [{ name: 'Bad' }] });
    expect(() => parseMenuSuggestionResponse(raw, ingredients)).toThrow(MenuSuggestionParseError);
  });

  it('tags an unmatched ingredient as new (null existingIngredientId)', () => {
    const raw = JSON.stringify({
      candidates: [
        candidate({
          name: 'Truffle Fries',
          price: 30000,
          category: 'Snacks',
          description: 'Fries with truffle oil.',
          instructions: 'Fry potatoes, toss in truffle oil.',
          ingredients: [{ name: 'Truffle Oil', unit: 'ml', qtyPerUnit: 10 }],
          reasoning: 'A creative new snack.',
        }),
      ],
    });
    const result = parseMenuSuggestionResponse(raw, ingredients);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidates[0].ingredients).toEqual([
        { name: 'Truffle Oil', unit: 'ml', qtyPerUnit: 10, existingIngredientId: null },
      ]);
    }
  });

  it('matches ingredient names case- and whitespace-insensitively', () => {
    const raw = JSON.stringify({
      candidates: [candidate({ ingredients: [{ name: '  RICE  ', unit: 'g', qtyPerUnit: 100 }] })],
    });
    const result = parseMenuSuggestionResponse(raw, ingredients);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.candidates[0].ingredients[0].existingIngredientId).toBe('i1');
  });

  it('returns ok:false when the AI reports no sensible suggestion, without throwing', () => {
    const raw = JSON.stringify({ error: 'Not enough ingredient variety to propose a coherent dish.' });
    const result = parseMenuSuggestionResponse(raw, ingredients);
    expect(result).toEqual({ ok: false, reason: 'Not enough ingredient variety to propose a coherent dish.' });
  });

  it('throws MenuSuggestionParseError on invalid JSON', () => {
    expect(() => parseMenuSuggestionResponse('not json', ingredients)).toThrow(MenuSuggestionParseError);
  });

  it('throws MenuSuggestionParseError when the candidates array is missing', () => {
    expect(() => parseMenuSuggestionResponse(JSON.stringify({ name: 'X' }), ingredients)).toThrow(
      MenuSuggestionParseError
    );
  });

  it('de-duplicates repeated ingredients that resolve to the same existing ingredient by exact name', () => {
    const raw = JSON.stringify({
      candidates: [
        candidate({
          ingredients: [
            { name: 'Rice', unit: 'g', qtyPerUnit: 100 },
            { name: 'Rice', unit: 'g', qtyPerUnit: 200 },
          ],
        }),
      ],
    });
    const result = parseMenuSuggestionResponse(raw, ingredients);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidates[0].ingredients).toEqual([
        { name: 'Rice', unit: 'g', qtyPerUnit: 100, existingIngredientId: 'i1' },
      ]);
    }
  });

  it('de-duplicates repeated ingredients that resolve to the same existing ingredient by case-different name', () => {
    const raw = JSON.stringify({
      candidates: [
        candidate({
          ingredients: [
            { name: 'Rice', unit: 'g', qtyPerUnit: 100 },
            { name: 'rice', unit: 'g', qtyPerUnit: 200 },
          ],
        }),
      ],
    });
    const result = parseMenuSuggestionResponse(raw, ingredients);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidates[0].ingredients).toEqual([
        { name: 'Rice', unit: 'g', qtyPerUnit: 100, existingIngredientId: 'i1' },
      ]);
    }
  });

  it('de-duplicates repeated unmatched ingredients that share a normalized name', () => {
    const raw = JSON.stringify({
      candidates: [
        candidate({
          ingredients: [
            { name: 'Truffle Oil', unit: 'ml', qtyPerUnit: 10 },
            { name: 'truffle oil', unit: 'ml', qtyPerUnit: 20 },
          ],
        }),
      ],
    });
    const result = parseMenuSuggestionResponse(raw, ingredients);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidates[0].ingredients).toEqual([
        { name: 'Truffle Oil', unit: 'ml', qtyPerUnit: 10, existingIngredientId: null },
      ]);
    }
  });

  it('inserts line breaks before numbered steps when the model runs them together on one line', () => {
    const raw = JSON.stringify({
      candidates: [candidate({ instructions: '1. Cook rice. 2. Cook chicken. 3. Assemble.' })],
    });
    const result = parseMenuSuggestionResponse(raw, ingredients);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidates[0].instructions).toBe('1. Cook rice.\n2. Cook chicken.\n3. Assemble.');
    }
  });

  it('leaves instructions untouched when the model already used real line breaks', () => {
    const raw = JSON.stringify({
      candidates: [candidate({ instructions: '1. Cook rice.\n2. Cook chicken.\n3. Assemble.' })],
    });
    const result = parseMenuSuggestionResponse(raw, ingredients);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidates[0].instructions).toBe('1. Cook rice.\n2. Cook chicken.\n3. Assemble.');
    }
  });
});

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

describe('buildMenuSuggestionMessages', () => {
  it('includes best sellers, ingredients, existing menu, and steering input', () => {
    const messages = buildMenuSuggestionMessages({
      bestSellers: [{ name: 'Latte', qtySold: 12 }],
      ingredients,
      existingItemNames: ['Latte', 'Espresso'],
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
    expect(user).toContain('Chicken Breast');
    expect(user).toContain('Korean');
    expect(user).toContain('Sweet');
    expect(user).toContain('Roasted');
    expect(user).toContain('Creamy');
    expect(user).toContain('Food');
    expect(user).toContain('use up chicken');
  });

  it('handles no best sellers and no steering input without throwing', () => {
    const messages = buildMenuSuggestionMessages({
      bestSellers: [],
      ingredients,
      existingItemNames: [],
      cuisine: [],
      taste: [],
      aroma: [],
      texture: [],
    });
    expect(messages).toHaveLength(2);
  });
});

describe('parseMenuSuggestionResponse', () => {
  it('parses a valid draft and tags an existing ingredient with its real id/unit', () => {
    const raw = JSON.stringify({
      name: 'Chicken Bibimbap',
      price: 42000,
      category: 'Korean',
      description: 'A rice bowl with chicken and vegetables.',
      instructions: '1. Cook rice. 2. Cook chicken. 3. Assemble.',
      ingredients: [{ name: 'rice', unit: 'g', qtyPerUnit: 200 }],
      reasoning: 'Uses low-stock chicken and a popular rice base.',
    });
    const result = parseMenuSuggestionResponse(raw, ingredients);
    expect(result).toEqual({
      ok: true,
      draft: {
        name: 'Chicken Bibimbap',
        price: 42000,
        category: 'Korean',
        description: 'A rice bowl with chicken and vegetables.',
        instructions: '1. Cook rice. 2. Cook chicken. 3. Assemble.',
        ingredients: [{ name: 'Rice', unit: 'g', qtyPerUnit: 200, existingIngredientId: 'i1' }],
        reasoning: 'Uses low-stock chicken and a popular rice base.',
      },
    });
  });

  it('tags an unmatched ingredient as new (null existingIngredientId)', () => {
    const raw = JSON.stringify({
      name: 'Truffle Fries',
      price: 30000,
      category: 'Snacks',
      description: 'Fries with truffle oil.',
      instructions: 'Fry potatoes, toss in truffle oil.',
      ingredients: [{ name: 'Truffle Oil', unit: 'ml', qtyPerUnit: 10 }],
      reasoning: 'A creative new snack.',
    });
    const result = parseMenuSuggestionResponse(raw, ingredients);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.ingredients).toEqual([
        { name: 'Truffle Oil', unit: 'ml', qtyPerUnit: 10, existingIngredientId: null },
      ]);
    }
  });

  it('matches ingredient names case- and whitespace-insensitively', () => {
    const raw = JSON.stringify({
      name: 'Dish',
      price: 10000,
      category: 'Food',
      description: 'd',
      instructions: 'i',
      ingredients: [{ name: '  RICE  ', unit: 'g', qtyPerUnit: 100 }],
      reasoning: 'r',
    });
    const result = parseMenuSuggestionResponse(raw, ingredients);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.draft.ingredients[0].existingIngredientId).toBe('i1');
  });

  it('returns ok:false when the AI reports no sensible suggestion, without throwing', () => {
    const raw = JSON.stringify({ error: 'Not enough ingredient variety to propose a coherent dish.' });
    const result = parseMenuSuggestionResponse(raw, ingredients);
    expect(result).toEqual({ ok: false, reason: 'Not enough ingredient variety to propose a coherent dish.' });
  });

  it('throws MenuSuggestionParseError on invalid JSON', () => {
    expect(() => parseMenuSuggestionResponse('not json', ingredients)).toThrow(MenuSuggestionParseError);
  });

  it('throws MenuSuggestionParseError when required fields are missing', () => {
    expect(() => parseMenuSuggestionResponse(JSON.stringify({ name: 'X' }), ingredients)).toThrow(
      MenuSuggestionParseError
    );
  });

  it('de-duplicates repeated ingredients that resolve to the same existing ingredient by exact name', () => {
    const raw = JSON.stringify({
      name: 'Dish',
      price: 10000,
      category: 'Food',
      description: 'd',
      instructions: 'i',
      ingredients: [
        { name: 'Rice', unit: 'g', qtyPerUnit: 100 },
        { name: 'Rice', unit: 'g', qtyPerUnit: 200 },
      ],
      reasoning: 'r',
    });
    const result = parseMenuSuggestionResponse(raw, ingredients);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.ingredients).toEqual([
        { name: 'Rice', unit: 'g', qtyPerUnit: 100, existingIngredientId: 'i1' },
      ]);
    }
  });

  it('de-duplicates repeated ingredients that resolve to the same existing ingredient by case-different name', () => {
    const raw = JSON.stringify({
      name: 'Dish',
      price: 10000,
      category: 'Food',
      description: 'd',
      instructions: 'i',
      ingredients: [
        { name: 'Rice', unit: 'g', qtyPerUnit: 100 },
        { name: 'rice', unit: 'g', qtyPerUnit: 200 },
      ],
      reasoning: 'r',
    });
    const result = parseMenuSuggestionResponse(raw, ingredients);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.ingredients).toEqual([
        { name: 'Rice', unit: 'g', qtyPerUnit: 100, existingIngredientId: 'i1' },
      ]);
    }
  });

  it('de-duplicates repeated unmatched ingredients that share a normalized name', () => {
    const raw = JSON.stringify({
      name: 'Dish',
      price: 10000,
      category: 'Food',
      description: 'd',
      instructions: 'i',
      ingredients: [
        { name: 'Truffle Oil', unit: 'ml', qtyPerUnit: 10 },
        { name: 'truffle oil', unit: 'ml', qtyPerUnit: 20 },
      ],
      reasoning: 'r',
    });
    const result = parseMenuSuggestionResponse(raw, ingredients);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.ingredients).toEqual([
        { name: 'Truffle Oil', unit: 'ml', qtyPerUnit: 10, existingIngredientId: null },
      ]);
    }
  });

  it('throws MenuSuggestionParseError on a malformed ingredient entry', () => {
    const raw = JSON.stringify({
      name: 'Dish',
      price: 10000,
      category: 'Food',
      description: 'd',
      instructions: 'i',
      ingredients: [{ name: 'Rice' }],
      reasoning: 'r',
    });
    expect(() => parseMenuSuggestionResponse(raw, ingredients)).toThrow(MenuSuggestionParseError);
  });
});

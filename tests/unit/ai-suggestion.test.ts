import { describe, it, expect } from 'vitest';
import {
  buildSuggestionMessages,
  parseSuggestionResponse,
  SuggestionParseError,
  type SuggestionMenuItem,
} from '@/server/ai/suggestion';

const menu: SuggestionMenuItem[] = [
  { id: 'm1', name: 'Latte', category: 'Coffee', price: 28000 },
  { id: 'm2', name: 'Chamomile', category: 'Tea', price: 17000 },
];

describe('buildSuggestionMessages', () => {
  it('includes preferences and every menu item id/name in the user message', () => {
    const messages = buildSuggestionMessages(
      { taste: ['Sweet'], aroma: [], texture: ['Creamy'], type: ['Coffee'], notes: 'no nuts please' },
      menu
    );
    expect(messages[0].role).toBe('system');
    const userContent = messages[1].content;
    expect(userContent).toContain('Sweet');
    expect(userContent).toContain('Creamy');
    expect(userContent).toContain('Coffee');
    expect(userContent).toContain('no nuts please');
    expect(userContent).toContain('m1');
    expect(userContent).toContain('Latte');
    expect(userContent).toContain('m2');
    expect(userContent).toContain('Chamomile');
  });

  it('handles no preferences selected at all without throwing', () => {
    const messages = buildSuggestionMessages({ taste: [], aroma: [], texture: [], type: [] }, menu);
    expect(messages).toHaveLength(2);
  });
});

describe('parseSuggestionResponse', () => {
  it('parses valid suggestions matching real menu items', () => {
    const raw = JSON.stringify({ suggestions: [{ menuItemId: 'm1', reason: 'Sweet and creamy' }] });
    const result = parseSuggestionResponse(raw, menu);
    expect(result).toEqual([{ menuItemId: 'm1', reason: 'Sweet and creamy' }]);
  });

  it('drops suggestions with an id not present in the menu', () => {
    const raw = JSON.stringify({
      suggestions: [
        { menuItemId: 'm1', reason: 'Real item' },
        { menuItemId: 'does-not-exist', reason: 'Hallucinated' },
      ],
    });
    const result = parseSuggestionResponse(raw, menu);
    expect(result).toEqual([{ menuItemId: 'm1', reason: 'Real item' }]);
  });

  it('caps results at 5 even if the model returns more', () => {
    const bigMenu: SuggestionMenuItem[] = Array.from({ length: 8 }, (_, i) => ({
      id: `m${i + 1}`,
      name: `Item ${i + 1}`,
      category: 'Coffee',
      price: 10000,
    }));
    const many = bigMenu.map((m, i) => ({ menuItemId: m.id, reason: `reason ${i}` }));
    const raw = JSON.stringify({ suggestions: many });
    const result = parseSuggestionResponse(raw, bigMenu);
    expect(result).toHaveLength(5);
  });

  it('dedupes repeated menuItemId values, keeping only one entry per id', () => {
    const raw = JSON.stringify({
      suggestions: [
        { menuItemId: 'm1', reason: 'First mention' },
        { menuItemId: 'm1', reason: 'Duplicate mention' },
      ],
    });
    const result = parseSuggestionResponse(raw, menu);
    expect(result).toEqual([{ menuItemId: 'm1', reason: 'First mention' }]);
  });

  it('throws SuggestionParseError on invalid JSON', () => {
    expect(() => parseSuggestionResponse('not json', menu)).toThrow(SuggestionParseError);
  });

  it('throws SuggestionParseError when the suggestions array is missing', () => {
    expect(() => parseSuggestionResponse(JSON.stringify({ foo: 'bar' }), menu)).toThrow(SuggestionParseError);
  });
});

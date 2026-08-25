import { describe, it, expect } from 'vitest';
import { TASTE_OPTIONS, AROMA_OPTIONS, TEXTURE_OPTIONS } from '@/lib/suggestionOptions';

describe('suggestion preference options', () => {
  it('each option list is non-empty with unique, non-empty string values', () => {
    for (const options of [TASTE_OPTIONS, AROMA_OPTIONS, TEXTURE_OPTIONS]) {
      expect(options.length).toBeGreaterThan(0);
      expect(new Set(options).size).toBe(options.length);
      for (const opt of options) {
        expect(typeof opt).toBe('string');
        expect(opt.length).toBeGreaterThan(0);
      }
    }
  });
});

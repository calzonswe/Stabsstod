import { describe, expect, it } from 'vitest';
import sv from './locales/sv.json' with { type: 'json' };
import en from './locales/en.json' with { type: 'json' };

describe('i18n key parity', () => {
  it('sv and en have the same keys', () => {
    const svKeys = Object.keys(sv).sort();
    const enKeys = Object.keys(en).sort();
    expect(svKeys).toEqual(enKeys);
  });

  it('all values are non-empty strings', () => {
    for (const value of Object.values(sv)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
    for (const value of Object.values(en)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });
});

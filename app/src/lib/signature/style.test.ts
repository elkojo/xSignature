import { describe, expect, it } from 'vitest';

import { INKS, SIZES, normalizeHex, sizeById } from './style';

describe('SIZES', () => {
  it('offers three sizes that really differ', () => {
    const sizes = SIZES.map((s) => s.fontSize);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(new Set(sizes).size).toBe(3);
  });

  it('falls back to the default for an unknown id', () => {
    expect(sizeById('enormous').id).toBe('default');
  });
});

describe('INKS', () => {
  it('offers eight, each a valid colour', () => {
    expect(INKS).toHaveLength(8);
    for (const ink of INKS) expect(normalizeHex(ink.hex)).toBe(ink.hex);
  });

  it('has no duplicates', () => {
    expect(new Set(INKS.map((i) => i.hex)).size).toBe(INKS.length);
  });
});

describe('normalizeHex', () => {
  it('accepts six digits', () => {
    expect(normalizeHex('#1F3A68')).toBe('#1f3a68');
  });

  it('expands three digits, so #abc and #aabbcc are one setting', () => {
    // They must normalise to the same string, or the swatch matching the
    // typed colour would fail to look selected.
    expect(normalizeHex('#abc')).toBe('#aabbcc');
    expect(normalizeHex('#abc')).toBe(normalizeHex('#AABBCC'));
  });

  it('does not require the hash', () => {
    expect(normalizeHex('1f3a68')).toBe('#1f3a68');
  });

  it('ignores surrounding space', () => {
    expect(normalizeHex('  #1f3a68 ')).toBe('#1f3a68');
  });

  it('rejects anything that is not a hex colour', () => {
    for (const bad of ['', '#', '#12', '#12345', '#1234567', 'red', '#12345g', 'rgb(1,2,3)']) {
      expect(normalizeHex(bad)).toBeNull();
    }
  });

  it('rejects a value that would end up in an SVG attribute unparsed', () => {
    // The SVG writer escapes, so this cannot break the markup — but a colour
    // that is not a colour renders as black with no explanation, which is
    // worse than refusing it in the field.
    expect(normalizeHex('"><script>')).toBeNull();
  });
});

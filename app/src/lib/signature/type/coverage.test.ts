import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'opentype.js';
import { describe, expect, it } from 'vitest';

import { unsupportedCharacters } from './coverage';

const font = parse(
  readFileSync(fileURLToPath(new URL('../fonts/DancingScript-Regular.ttf', import.meta.url))).buffer,
);

describe('unsupportedCharacters', () => {
  it('finds nothing wrong with plain Latin', () => {
    expect(unsupportedCharacters(font, 'Ada Lovelace')).toEqual([]);
  });

  it('accepts the Latin Extended the face actually ships', () => {
    // Dancing Script covers latin-ext, so Czech diacritics are real glyphs
    // rather than boxes. Worth pinning: it is the difference between a name
    // and a row of rectangles.
    expect(unsupportedCharacters(font, 'Jiří Novák')).toEqual([]);
    expect(unsupportedCharacters(font, 'Příliš žluťoučký kůň')).toEqual([]);
  });

  it('reports characters the face cannot draw', () => {
    expect(unsupportedCharacters(font, '日本語')).toEqual(['日', '本', '語']);
  });

  it('reports each character once, in the order first met', () => {
    expect(unsupportedCharacters(font, '語日語')).toEqual(['語', '日']);
  });

  it('never complains about whitespace', () => {
    expect(unsupportedCharacters(font, '  Ada\tLovelace\n')).toEqual([]);
  });

  it('counts a character outside the basic plane as one character', () => {
    // Naively iterating UTF-16 units would report this as two broken halves.
    const missing = unsupportedCharacters(font, 'Ada 😀');
    expect(missing).toEqual(['😀']);
  });

  it('finds nothing in an empty string', () => {
    expect(unsupportedCharacters(font, '')).toEqual([]);
  });
});

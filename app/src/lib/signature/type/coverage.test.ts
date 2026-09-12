import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'opentype.js';
import { describe, expect, it } from 'vitest';

import { FACES } from './faces';
import { unsupportedCharacters } from './coverage';

const load = (file: string) =>
  parse(readFileSync(fileURLToPath(new URL(`../fonts/${file}`, import.meta.url))).buffer);

const font = load('DancingScript-Regular.ttf');

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

describe('what the bundled faces actually cover', () => {
  // The catalogue and the files have to stay in step: a face listed with no
  // file behind it is a button that loads nothing.
  const files: Record<string, string> = {
    'dancing-script': 'DancingScript-Regular.ttf',
    caveat: 'Caveat-Regular.ttf',
    'great-vibes': 'GreatVibes-Regular.ttf',
    allura: 'Allura-Regular.ttf',
    parisienne: 'Parisienne-Regular.ttf',
    sacramento: 'Sacramento-Regular.ttf',
    'mr-de-haviland': 'MrDeHaviland-Regular.ttf',
  };

  it('has a bundled file for every face offered', () => {
    expect(FACES.map((f) => f.id).sort()).toEqual(Object.keys(files).sort());
  });

  it('draws plain Latin, digits and punctuation in every face', () => {
    for (const [id, file] of Object.entries(files)) {
      expect([id, unsupportedCharacters(load(file), "Ada Lovelace 0123456789 .,'-&()")]).toEqual([
        id,
        [],
      ]);
    }
  });

  it('draws Czech, Polish, German and French accents in every face but one', () => {
    const accented = 'Příliš žluťoučký kůň Łukasz Wałęsa Jürgen Groß Françoise';
    for (const [id, file] of Object.entries(files)) {
      if (id === 'mr-de-haviland') continue;
      expect([id, unsupportedCharacters(load(file), accented)]).toEqual([id, []]);
    }
  });

  it('pins the one face that cannot: Mr De Haviland has no Czech or Polish accents', () => {
    // Not a defect to fix — the face simply has no such glyphs — but it must
    // not be a surprise. The catalogue says so in its note, and the UI names
    // the characters before anything reaches a file.
    const missing = unsupportedCharacters(load(files['mr-de-haviland']), 'Příliš žluťoučký kůň Wałęsa');
    expect(missing.length).toBeGreaterThan(0);
    expect(FACES.find((f) => f.id === 'mr-de-haviland')!.note).toMatch(/no Czech or Polish accents/);
  });
});

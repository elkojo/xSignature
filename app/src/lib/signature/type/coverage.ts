import type { Font } from 'opentype.js';

/**
 * The characters this face cannot draw.
 *
 * A font asked for a glyph it does not have returns `.notdef` — usually an
 * empty rectangle. Nothing errors, nothing is logged, and the export succeeds:
 * the user gets a picture of three boxes and no reason to think it is anything
 * other than what this app produces. Silence here is the worst available
 * behaviour, so the caller is told and can say so.
 *
 * Whitespace is excluded: a space has no outline by design, and reporting it as
 * unsupported would be noise on every name with two words in it.
 *
 * Returns each offending character once, in the order first met.
 */
export function unsupportedCharacters(font: Font, text: string): string[] {
  const missing: string[] = [];
  const seen = new Set<string>();

  // Iterate by code point, not by UTF-16 unit, so an emoji or any other
  // character outside the basic plane is reported as one character.
  for (const character of text) {
    if (/\s/.test(character) || seen.has(character)) continue;
    seen.add(character);
    if (font.charToGlyphIndex(character) === 0) missing.push(character);
  }

  return missing;
}

import type { Font } from 'opentype.js';

import { normalize, type PathCommand } from '../path';

/**
 * Turn text into outlines.
 *
 * This is the step that makes the exported SVG worth anything. Setting the name
 * as an SVG `<text>` element would be less code and would look identical on this
 * machine — and would then render in Times New Roman on a machine without the
 * font, which for a signature is not a degraded result but a wrong one. Outlines
 * carry no such dependency: the shapes are in the file.
 *
 * The returned commands sit on a baseline at y = 0, with the first glyph
 * starting at x = 0. That leaves the ink wherever the glyphs put it, above and
 * below the baseline and often left of the origin on a script face with an
 * entry stroke. Placing it properly is the bounding box's job, not this one's —
 * guessing here would mean guessing twice.
 */
export interface TypeOptions {
  /**
   * Em size in the same units the output is in. Real size, not a scale factor
   * applied afterwards: hinting and glyph positioning are computed at this
   * size, so 40 is a font set at 40, never a font set at 10 and blown up.
   */
  readonly fontSize: number;
}

export function textToPath(font: Font, text: string, options: TypeOptions): PathCommand[] {
  if (!text) return [];

  // opentype's own command objects are already exactly our shape; the cast is
  // the type system catching up with a structural fact, not a conversion.
  const raw = shape(font, text, options.fontSize) as PathCommand[];

  // What comes back is faithful but wasteful — see normalize().
  return normalize(raw);
}

/**
 * Lay the text out, preferring the font library's own shaper.
 *
 * `font.getPath` applies the font's substitution rules — ligatures, and the
 * required joins a script face needs — and is what should run. But it throws
 * outright on some perfectly valid fonts: opentype.js 2.0.0 does not implement
 * every GSUB lookup type, and meeting one is a hard error rather than a
 * skipped feature. Great Vibes, bundled here, fails on every string with
 * "substitutionType : 62 lookupType: 6 - substFormat: 2 is not yet supported".
 *
 * So this falls back to placing one glyph at a time. That loses substitution —
 * the glyphs are the font's defaults rather than its contextual choices — but
 * it keeps kerning, and a face that lays out slightly plainly is a great deal
 * better than a face that takes the app down with it.
 *
 * The wider point is that this function does not throw. It is called from a
 * reactive expression, and an exception there stops the interface updating at
 * all: the first version of this froze the whole page on a blank preview, with
 * the failure visible only in the console.
 */
function shape(font: Font, text: string, fontSize: number): PathCommand[] {
  try {
    return font.getPath(text, 0, 0, fontSize).commands as PathCommand[];
  } catch {
    return layoutGlyphByGlyph(font, text, fontSize);
  }
}

function layoutGlyphByGlyph(font: Font, text: string, fontSize: number): PathCommand[] {
  const scale = fontSize / font.unitsPerEm;
  const commands: PathCommand[] = [];

  let x = 0;
  let previous: ReturnType<Font['charToGlyph']> | null = null;

  // By code point, so a character outside the basic plane is one glyph lookup
  // rather than two broken halves.
  for (const character of text) {
    const glyph = font.charToGlyph(character);

    // Kerning is the one piece of positioning worth keeping here: without it
    // a script face's letters sit visibly apart.
    if (previous) x += font.getKerningValue(previous, glyph) * scale;

    commands.push(...(glyph.getPath(x, 0, fontSize).commands as PathCommand[]));
    x += (glyph.advanceWidth ?? 0) * scale;
    previous = glyph;
  }

  return commands;
}

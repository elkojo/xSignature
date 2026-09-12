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
  const raw = font.getPath(text, 0, 0, options.fontSize).commands as PathCommand[];

  // What comes back is faithful but wasteful — see normalize().
  return normalize(raw);
}

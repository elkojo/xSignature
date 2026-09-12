/**
 * The choices a signature has: a face, a size, an ink.
 *
 * Data, not geometry. The export pipeline reads the numbers this produces and
 * knows nothing about which swatch was clicked.
 */

/**
 * Size is an em size handed to the font, not a scale applied to a finished
 * drawing.
 *
 * That distinction is the whole reason these are numbers rather than CSS
 * transforms: at 180 the glyphs are laid out at 180 and their curves are
 * computed there. Scaling a 60pt rendering up to 180 would give the same
 * outline three times as coarse, and in the PNG it would be visible.
 */
export const SIZES = [
  { id: 'small', label: 'Small', fontSize: 72 },
  { id: 'default', label: 'Default', fontSize: 120 },
  { id: 'large', label: 'Large', fontSize: 190 },
] as const;

export type SizeId = (typeof SIZES)[number]['id'];
export const DEFAULT_SIZE_ID: SizeId = 'default';

export function sizeById(id: string): (typeof SIZES)[number] {
  return SIZES.find((s) => s.id === id) ?? SIZES[1];
}

/**
 * Eight inks, chosen as pen colours rather than as UI colours.
 *
 * White is here because a signature going onto a dark letterhead needs it, and
 * because the alternative — leaving it to the hex field — hides it from the
 * people most likely to want it.
 */
export const INKS = [
  { id: 'black', name: 'Black', hex: '#12130f' },
  { id: 'graphite', name: 'Graphite', hex: '#4a514e' },
  { id: 'ink-blue', name: 'Ink blue', hex: '#1f3a68' },
  { id: 'royal', name: 'Royal blue', hex: '#2a54c6' },
  { id: 'forest', name: 'Forest', hex: '#173f32' },
  { id: 'burgundy', name: 'Burgundy', hex: '#7a2230' },
  { id: 'sepia', name: 'Sepia', hex: '#5c4433' },
  { id: 'white', name: 'White', hex: '#ffffff' },
] as const;

export const DEFAULT_INK = INKS[0].hex;

/**
 * Accept a hex colour typed by hand, or reject it.
 *
 * Returned in a single normalised form so that `#ABC`, `#abc` and `#aabbcc`
 * are one setting rather than three, which matters because this string is
 * compared against the swatches to decide which one looks selected.
 *
 * Deliberately strict: this value is written into an SVG attribute, and while
 * the writer escapes it, a colour that is not a colour produces a file that
 * silently renders as black. Better to refuse it in the field.
 */
export function normalizeHex(input: string): string | null {
  const value = input.trim().replace(/^#/, '');

  if (/^[0-9a-fA-F]{3}$/.test(value)) {
    return `#${value
      .toLowerCase()
      .split('')
      .map((c) => c + c)
      .join('')}`;
  }

  if (/^[0-9a-fA-F]{6}$/.test(value)) return `#${value.toLowerCase()}`;

  return null;
}

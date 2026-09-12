import { toPathData, type PathCommand } from '../path';
import { pathBounds } from './bounds';
import { layout, type LayoutOptions } from './layout';

export interface SvgOptions extends LayoutOptions {
  /** Any CSS colour. Written straight into a `fill` attribute. */
  readonly color: string;
  /**
   * Multiplies the declared width and height only. The viewBox is unchanged, so
   * the file stays resolution-independent and a scaled SVG is the same drawing
   * at a different natural size — which is what makes it comparable to the PNG
   * exported at the same scale.
   */
  readonly scale?: number;
  /** Decimal places kept in the path data. */
  readonly precision?: number;
}

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Trim a number for an attribute: 240 rather than 240.00000000000003. */
const round = (value: number): string => String(Number(value.toFixed(3)));

/**
 * Write the signature as an SVG made of paths.
 *
 * No `<text>` element and no embedded font, on purpose. An SVG that names a
 * font renders correctly only where that font is installed, and everywhere else
 * it silently substitutes — a signature in Times New Roman, which is not a
 * degraded result but somebody else's handwriting. Outlines depend on nothing.
 *
 * Returns null when there is no ink to draw.
 */
export function toSvg(commands: readonly PathCommand[], options: SvgOptions): string | null {
  const bounds = pathBounds(commands);
  if (!bounds) return null;

  const box = layout(bounds, options);
  const scale = options.scale ?? 1;

  // Baked into the path data rather than applied with a transform attribute, so
  // the `d` is already in the coordinate space the viewBox describes. One less
  // thing for a downstream tool to get wrong when it reads the file.
  const placed = commands.map((c) =>
    c.type === 'Z'
      ? c
      : c.type === 'C'
        ? {
            ...c,
            x1: c.x1 + box.translateX,
            y1: c.y1 + box.translateY,
            x2: c.x2 + box.translateX,
            y2: c.y2 + box.translateY,
            x: c.x + box.translateX,
            y: c.y + box.translateY,
          }
        : c.type === 'Q'
          ? {
              ...c,
              x1: c.x1 + box.translateX,
              y1: c.y1 + box.translateY,
              x: c.x + box.translateX,
              y: c.y + box.translateY,
            }
          : { ...c, x: c.x + box.translateX, y: c.y + box.translateY },
  );

  const d = toPathData(placed, options.precision);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `width="${round(box.width * scale)}" height="${round(box.height * scale)}" ` +
    `viewBox="0 0 ${round(box.width)} ${round(box.height)}">` +
    `<path d="${d}" fill="${escapeAttribute(options.color)}"/>` +
    `</svg>\n`
  );
}

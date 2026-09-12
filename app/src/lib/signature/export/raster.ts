import type { PathCommand } from '../path';
import { pathBounds } from './bounds';
import { layout, type LayoutOptions } from './layout';

/**
 * The part of `Path2D` this module uses.
 *
 * Declared rather than imported so the replay below can be driven by something
 * that only records what it was asked to draw. That is how the PNG's geometry
 * gets checked against the SVG's without a browser in the room.
 */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  closePath(): void;
}

/**
 * Issue the same geometry to a canvas path that the SVG writes as path data.
 *
 * The two output formats share this command list, so the only way they can
 * disagree is if this function and the SVG writer read it differently. They are
 * deliberately both thin.
 */
export function replay(commands: readonly PathCommand[], sink: PathSink): void {
  for (const c of commands) {
    switch (c.type) {
      case 'M':
        sink.moveTo(c.x, c.y);
        break;
      case 'L':
        sink.lineTo(c.x, c.y);
        break;
      case 'Q':
        sink.quadraticCurveTo(c.x1, c.y1, c.x, c.y);
        break;
      case 'C':
        sink.bezierCurveTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y);
        break;
      case 'Z':
        sink.closePath();
        break;
    }
  }
}

export interface PngOptions extends LayoutOptions {
  readonly color: string;
  /** Pixels per user unit. 2 gives a file twice as wide and twice as tall. */
  readonly scale?: number;
  /**
   * Fit inside a box of exactly this many pixels instead of multiplying by a
   * scale. The signature keeps its proportions and is centred in whatever
   * space is left over, so the file is the size the slot expects — a form
   * field, or a mail signature with a fixed image box — rather than whatever
   * size the handwriting happened to come out at.
   *
   * Takes precedence over `scale`.
   */
  readonly fit?: { readonly width: number; readonly height: number };
  /**
   * Paint this behind the signature instead of leaving it transparent. For the
   * tools — some form fillers, some older word processors — that render an
   * alpha channel as black.
   */
  readonly background?: string;
}

/** Where the ink lands on the canvas, and how big the canvas is. */
interface Placement {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  /** Applied after scaling, to centre a fitted signature in its box. */
  readonly offsetX: number;
  readonly offsetY: number;
  readonly translateX: number;
  readonly translateY: number;
}

/**
 * Work out the canvas and the transform once, so the size reported to the
 * interface and the size actually drawn cannot drift apart.
 */
function placement(commands: readonly PathCommand[], options: PngOptions): Placement | null {
  const bounds = pathBounds(commands);
  if (!bounds) return null;

  const box = layout(bounds, options);

  if (options.fit) {
    const width = Math.max(1, Math.round(options.fit.width));
    const height = Math.max(1, Math.round(options.fit.height));
    // The smaller of the two ratios: whichever edge runs out first decides,
    // which is what keeps the signature from being stretched to fill the box.
    const scale = Math.min(width / box.width, height / box.height);

    return {
      width,
      height,
      scale,
      offsetX: (width - box.width * scale) / 2,
      offsetY: (height - box.height * scale) / 2,
      translateX: box.translateX,
      translateY: box.translateY,
    };
  }

  const scale = options.scale ?? 1;
  return {
    // Rounded up: a fractional canvas is not a thing, and rounding down would
    // shave the last column of pixels off the padding.
    width: Math.max(1, Math.ceil(box.width * scale)),
    height: Math.max(1, Math.ceil(box.height * scale)),
    scale,
    offsetX: 0,
    offsetY: 0,
    translateX: box.translateX,
    translateY: box.translateY,
  };
}

/** The pixel size of the PNG a given path and options will produce. */
export function pngSize(
  commands: readonly PathCommand[],
  options: PngOptions,
): { width: number; height: number } | null {
  const place = placement(commands, options);
  return place ? { width: place.width, height: place.height } : null;
}

/**
 * Rasterize the same paths the SVG is built from.
 *
 * Not a screenshot of the SVG, and not a second drawing: the command list, the
 * bounding box and the layout are the ones the SVG used, transformed onto a
 * canvas. Canvas and SVG both fill with the nonzero winding rule by default,
 * which is also the rule TrueType outlines assume, so the counters in an "a" or
 * an "o" come out hollow in both.
 *
 * Returns null when there is no ink to draw.
 */
export async function toPng(
  commands: readonly PathCommand[],
  options: PngOptions,
): Promise<Blob | null> {
  const place = placement(commands, options);
  if (!place) return null;

  const canvas = document.createElement('canvas');
  canvas.width = place.width;
  canvas.height = place.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser did not provide a 2D canvas.');

  // A fresh canvas is already transparent, so the default costs nothing.
  if (options.background) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, place.width, place.height);
  }

  ctx.setTransform(
    place.scale,
    0,
    0,
    place.scale,
    place.offsetX + place.translateX * place.scale,
    place.offsetY + place.translateY * place.scale,
  );

  const path = new Path2D();
  replay(commands, path);

  ctx.fillStyle = options.color;
  ctx.fill(path);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The browser could not encode the PNG.'))),
      'image/png',
    );
  });
}

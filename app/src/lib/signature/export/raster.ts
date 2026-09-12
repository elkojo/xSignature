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
   * Paint this behind the signature instead of leaving it transparent. For the
   * tools — some form fillers, some older word processors — that render an
   * alpha channel as black.
   */
  readonly background?: string;
}

/** The pixel size of the PNG a given path and options will produce. */
export function pngSize(
  commands: readonly PathCommand[],
  options: PngOptions,
): { width: number; height: number } | null {
  const bounds = pathBounds(commands);
  if (!bounds) return null;

  const box = layout(bounds, options);
  const scale = options.scale ?? 1;

  // Rounded up: a fractional canvas is not a thing, and rounding down would
  // shave the last column of pixels off the padding.
  return {
    width: Math.max(1, Math.ceil(box.width * scale)),
    height: Math.max(1, Math.ceil(box.height * scale)),
  };
}

/**
 * Rasterize the same paths the SVG is built from.
 *
 * Not a screenshot of the SVG, and not a second drawing: the command list, the
 * bounding box and the layout are the ones the SVG used, transformed onto a
 * canvas at `scale`. Canvas and SVG both fill with the nonzero winding rule by
 * default, which is also the rule TrueType outlines assume, so the counters in
 * an "a" or an "o" come out hollow in both.
 *
 * Returns null when there is no ink to draw.
 */
export async function toPng(
  commands: readonly PathCommand[],
  options: PngOptions,
): Promise<Blob | null> {
  const bounds = pathBounds(commands);
  if (!bounds) return null;

  const box = layout(bounds, options);
  const scale = options.scale ?? 1;
  const size = pngSize(commands, options)!;

  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser did not provide a 2D canvas.');

  // A fresh canvas is already transparent, so the default costs nothing.
  if (options.background) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, size.width, size.height);
  }

  ctx.setTransform(scale, 0, 0, scale, box.translateX * scale, box.translateY * scale);

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

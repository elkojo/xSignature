import SignaturePad from 'signature_pad';

import { parseSignaturePadSvg, type DrawnInk } from './segments';

export interface PadOptions {
  readonly penColor: string;
  /** Thinnest and thickest the line gets, before the velocity taper. */
  readonly minWidth?: number;
  readonly maxWidth?: number;
}

/**
 * Wrap signature_pad, and keep the canvas honest about its own size.
 *
 * A canvas has two sizes — the box it occupies and the pixel grid it draws on —
 * and if they disagree the ink lands somewhere other than the pointer. Sizing
 * the grid to the CSS box times the device pixel ratio is what keeps a stroke
 * under the nib on a phone.
 *
 * Resizing clears the canvas, which is why the strokes are taken out and put
 * back around it. Losing someone's signature because they turned their phone
 * would be an unkind way to find out about this.
 */
export function createPad(canvas: HTMLCanvasElement, options: PadOptions): SignaturePad {
  return new SignaturePad(canvas, {
    penColor: options.penColor,
    minWidth: options.minWidth ?? 1.1,
    maxWidth: options.maxWidth ?? 3.2,
    // Left transparent so the exported ink is the ink and nothing else. The
    // checkerboard behind the canvas is CSS, not pixels.
    backgroundColor: 'rgba(0,0,0,0)',
  });
}

export function fitPad(pad: SignaturePad, canvas: HTMLCanvasElement): void {
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const width = canvas.offsetWidth;
  const height = canvas.offsetHeight;
  if (!width || !height) return;

  const wanted = { width: Math.round(width * ratio), height: Math.round(height * ratio) };
  if (canvas.width === wanted.width && canvas.height === wanted.height) return;

  const strokes = pad.toData();
  canvas.width = wanted.width;
  canvas.height = wanted.height;
  canvas.getContext('2d')?.scale(ratio, ratio);
  pad.clear();
  if (strokes.length) pad.fromData(strokes);
}

/** Drop the last stroke. Undo, in the only sense this app needs. */
export function undoStroke(pad: SignaturePad): void {
  const strokes = pad.toData();
  if (!strokes.length) return;
  strokes.pop();
  pad.fromData(strokes);
}

/**
 * Read the drawn ink back out as curves.
 *
 * Via the library's own SVG, which is where it publishes the smoothing and the
 * velocity widths it worked out. See parseSignaturePadSvg.
 */
export function inkFrom(pad: SignaturePad): DrawnInk {
  if (pad.isEmpty()) return { segments: [], dots: [] };
  return parseSignaturePadSvg(pad.toSVG());
}

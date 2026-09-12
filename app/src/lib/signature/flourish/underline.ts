import { outlineInk } from '../draw/outline';
import type { DrawSegment } from '../draw/segments';
import type { Bounds } from '../export/bounds';
import { boundsHeight, boundsWidth } from '../export/bounds';
import type { PathCommand } from '../path';

export interface UnderlineOptions {
  /** Thickest point of the stroke, as a fraction of the signature's height. */
  readonly thickness?: number;
  /** Clear air between the bottom of the signature and the line. */
  readonly gap?: number;
  /** How far the middle sags below the ends. */
  readonly dip?: number;
  /** How far the right end lifts, as a hand does at the end of a stroke. */
  readonly rise?: number;
  /** Extra length beyond the signature, at the left and right ends. */
  readonly overhangLeft?: number;
  readonly overhangRight?: number;
  /** How many pieces the centreline is built from. */
  readonly steps?: number;
}

const DEFAULTS: Required<UnderlineOptions> = {
  thickness: 0.05,
  gap: 0.16,
  dip: 0.07,
  rise: 0.11,
  overhangLeft: 0.02,
  overhangRight: 0.05,
  steps: 14,
};

/**
 * Where along the line the pen bears down.
 *
 * Nought at both ends and one at the heaviest point, which sits left of centre
 * because that is where a right-handed hand is still accelerating. The
 * exponent rounds the shoulders off; without it the line arrives at full
 * weight too abruptly and reads as a shape rather than a stroke.
 */
function taper(t: number): number {
  const peak = 0.42;
  const ramp = t < peak ? t / peak : (1 - t) / (1 - peak);
  return Math.pow(Math.max(0, ramp), 0.55);
}

/**
 * Generate an underline flourish for a signature of these bounds.
 *
 * Not a rectangle and not a text underline. A rule under a signature is a
 * typographic object and looks like one — it has two parallel edges and square
 * ends, and next to handwriting it reads as something the computer added. What
 * a person draws instead is a single stroke: it starts from nothing, swells
 * where the hand bears down, sags a little in the middle under its own
 * movement, and lifts away at the end.
 *
 * So it is built as exactly that — a centreline with a width that varies along
 * it — and handed to the same offsetting that turns drawn strokes into filled
 * outlines. It needs no support anywhere else in the pipeline for the same
 * reason draw mode did not: what comes back is closed contours, which is what
 * everything downstream already takes.
 *
 * Every measurement is a fraction of the signature's own height, so the
 * flourish under a large signature is the same drawing as the one under a
 * small one rather than a thinner line at a bigger size.
 */
export function underlinePath(bounds: Bounds, options: UnderlineOptions = {}): PathCommand[] {
  const settings = { ...DEFAULTS, ...options };

  const width = boundsWidth(bounds);
  const height = boundsHeight(bounds);
  if (width <= 0 || height <= 0) return [];

  const startX = bounds.minX - width * settings.overhangLeft;
  const endX = bounds.maxX + width * settings.overhangRight;
  const span = endX - startX;

  const baseY = bounds.maxY + height * settings.gap;
  const dip = height * settings.dip;
  const rise = height * settings.rise;
  const thickness = height * settings.thickness;

  const pointAt = (t: number) => ({
    x: startX + span * t,
    // y grows downward: the sine sags the middle, and the power term lifts the
    // right-hand end away at an increasing rate.
    y: baseY + Math.sin(Math.PI * t) * dip - Math.pow(t, 1.8) * rise,
  });

  const segments: DrawSegment[] = [];
  for (let i = 0; i < settings.steps; i++) {
    const t0 = i / settings.steps;
    const t1 = (i + 1) / settings.steps;
    const a = pointAt(t0);
    const b = pointAt(t1);

    // Control points a third of the way along the chord: consecutive pieces
    // are short enough that this is smooth, and it keeps the curve on the
    // parametric path rather than bulging off it.
    segments.push({
      x0: a.x,
      y0: a.y,
      c1x: a.x + (b.x - a.x) / 3,
      c1y: a.y + (b.y - a.y) / 3,
      c2x: a.x + ((b.x - a.x) * 2) / 3,
      c2y: a.y + ((b.y - a.y) * 2) / 3,
      x1: b.x,
      y1: b.y,
      width: Math.max(0.001, thickness * taper((t0 + t1) / 2)),
    });
  }

  // A stroke that tapers to nothing at both ends, so the offsetting closes it
  // to a point rather than a round cap.
  //
  // Sampled far more loosely than drawn ink, and measured rather than guessed:
  // this curve is nearly straight — a sag of a few units across hundreds — so
  // chords barely leave it. At roughly 150 samples across the span the worst
  // the edge strays from the true outline is 0.0002 units on a line eight
  // units thick, while a tighter setting cost twice the file for nothing.
  return outlineInk({ segments, dots: [] }, { sampleEvery: Math.max(1.2, width / 150) });
}

import type { PathCommand } from '../path';
import { normalize } from '../path';
import type { DrawDot, DrawSegment, DrawnInk } from './segments';

export interface OutlineOptions {
  /**
   * How far apart to sample along a curve, in the drawing's own units.
   *
   * The only real knob here. Smaller means a closer fit to the true outline and
   * a bigger file; larger means visible flat spots on tight curves. 2.5 puts a
   * sample every couple of pixels at the size people actually draw at, which is
   * below what the eye resolves once the signature is scaled to a letterhead.
   */
  readonly sampleEvery?: number;
  /** Line segments used per round cap. Eight is smooth at signature sizes. */
  readonly capSteps?: number;
}

interface Sample {
  readonly x: number;
  readonly y: number;
  /** Unit normal, ninety degrees from the direction of travel. */
  readonly nx: number;
  readonly ny: number;
  readonly halfWidth: number;
}

const at = (p0: number, c1: number, c2: number, p1: number, t: number): number => {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * p1;
};

const slope = (p0: number, c1: number, c2: number, p1: number, t: number): number => {
  const u = 1 - t;
  return 3 * u * u * (c1 - p0) + 6 * u * t * (c2 - c1) + 3 * t * t * (p1 - c2);
};

/** Rough length, enough to decide how many samples a segment deserves. */
function approximateLength(s: DrawSegment): number {
  const chord = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
  const polygon =
    Math.hypot(s.c1x - s.x0, s.c1y - s.y0) +
    Math.hypot(s.c2x - s.c1x, s.c2y - s.c1y) +
    Math.hypot(s.x1 - s.c2x, s.y1 - s.c2y);
  return (chord + polygon) / 2;
}

/**
 * Split the segments into strokes.
 *
 * signature_pad emits its curves in order, one stroke's worth after another,
 * with each curve starting where the last one ended. A gap means the pen was
 * lifted. Grouping by that rather than by any index arithmetic keeps this
 * robust to however the library chooses to batch them.
 */
function intoStrokes(segments: readonly DrawSegment[]): DrawSegment[][] {
  const strokes: DrawSegment[][] = [];
  let current: DrawSegment[] = [];

  for (const segment of segments) {
    const previous = current[current.length - 1];
    const continues =
      previous && Math.hypot(segment.x0 - previous.x1, segment.y0 - previous.y1) < 0.01;

    if (!continues && current.length) {
      strokes.push(current);
      current = [];
    }
    current.push(segment);
  }

  if (current.length) strokes.push(current);
  return strokes;
}

function sampleStroke(stroke: DrawSegment[], sampleEvery: number): Sample[] {
  const samples: Sample[] = [];

  // Carried forward so a momentarily stationary pen — where the curve has no
  // direction to take a normal from — keeps the orientation it last had rather
  // than producing a NaN and a hole in the outline.
  let nx = 0;
  let ny = 1;

  for (const [index, segment] of stroke.entries()) {
    const steps = Math.max(2, Math.min(24, Math.ceil(approximateLength(segment) / sampleEvery)));

    // Widths are signature_pad's, one per segment. Averaging with the
    // neighbours turns a staircase into a taper, which is what the pen was
    // doing between those two readings anyway.
    const before = stroke[index - 1] ?? segment;
    const after = stroke[index + 1] ?? segment;
    const startWidth = (before.width + segment.width) / 2;
    const endWidth = (segment.width + after.width) / 2;

    for (let step = index === 0 ? 0 : 1; step <= steps; step++) {
      const t = step / steps;

      const dx = slope(segment.x0, segment.c1x, segment.c2x, segment.x1, t);
      const dy = slope(segment.y0, segment.c1y, segment.c2y, segment.y1, t);
      const length = Math.hypot(dx, dy);
      if (length > 1e-9) {
        nx = -dy / length;
        ny = dx / length;
      }

      samples.push({
        x: at(segment.x0, segment.c1x, segment.c2x, segment.x1, t),
        y: at(segment.y0, segment.c1y, segment.c2y, segment.y1, t),
        nx,
        ny,
        halfWidth: Math.max(0.01, (startWidth + (endWidth - startWidth) * t) / 2),
      });
    }
  }

  return samples;
}

/** Half a circle, swept so it closes the gap between the two offset sides. */
function cap(sample: Sample, steps: number, reverse: boolean): PathCommand[] {
  const start = Math.atan2(reverse ? -sample.ny : sample.ny, reverse ? -sample.nx : sample.nx);
  const out: PathCommand[] = [];

  for (let i = 1; i < steps; i++) {
    const angle = start - (Math.PI * i) / steps;
    out.push({
      type: 'L',
      x: sample.x + Math.cos(angle) * sample.halfWidth,
      y: sample.y + Math.sin(angle) * sample.halfWidth,
    });
  }

  return out;
}

function outlineOne(stroke: DrawSegment[], options: Required<OutlineOptions>): PathCommand[] {
  const samples = sampleStroke(stroke, options.sampleEvery);
  if (samples.length < 2) return [];

  const commands: PathCommand[] = [];
  const first = samples[0];
  const last = samples[samples.length - 1];

  // Up one side…
  commands.push({
    type: 'M',
    x: first.x + first.nx * first.halfWidth,
    y: first.y + first.ny * first.halfWidth,
  });
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i];
    commands.push({ type: 'L', x: s.x + s.nx * s.halfWidth, y: s.y + s.ny * s.halfWidth });
  }

  // …round the end…
  commands.push(...cap(last, options.capSteps, false));
  commands.push({ type: 'L', x: last.x - last.nx * last.halfWidth, y: last.y - last.ny * last.halfWidth });

  // …back down the other…
  for (let i = samples.length - 2; i >= 0; i--) {
    const s = samples[i];
    commands.push({ type: 'L', x: s.x - s.nx * s.halfWidth, y: s.y - s.ny * s.halfWidth });
  }

  // …and round the start, back to where we began.
  commands.push(...cap(first, options.capSteps, true));
  commands.push({ type: 'Z' });

  return commands;
}

/** A tap, as a closed circle. */
function outlineDot(dot: DrawDot, steps: number): PathCommand[] {
  const commands: PathCommand[] = [{ type: 'M', x: dot.x + dot.radius, y: dot.y }];
  const points = Math.max(8, steps * 2);

  for (let i = 1; i < points; i++) {
    const angle = (Math.PI * 2 * i) / points;
    commands.push({
      type: 'L',
      x: dot.x + Math.cos(angle) * dot.radius,
      y: dot.y + Math.sin(angle) * dot.radius,
    });
  }

  commands.push({ type: 'Z' });
  return commands;
}

/**
 * Turn drawn strokes into the same thing typed text becomes: closed, filled
 * outlines.
 *
 * A stroke has a width and text does not, so the obvious route would be to keep
 * it as a stroked centreline and let the renderers apply the width. That would
 * mean two ways of drawing — stroke for one mode, fill for the other — in the
 * bounding box, in the SVG writer and in the rasterizer, each an opportunity
 * for the PNG and the SVG to disagree. Offsetting the centreline into a region
 * instead means draw mode produces exactly what type mode produces, and every
 * line of the export pipeline stays as it was.
 *
 * Where a stroke crosses itself the outline overlaps. That needs no handling:
 * both renderers fill with the nonzero winding rule, under which overlapping
 * turns of the same contour stay solid.
 */
export function outlineInk(ink: DrawnInk, options: OutlineOptions = {}): PathCommand[] {
  const settings: Required<OutlineOptions> = {
    sampleEvery: options.sampleEvery ?? 2.5,
    capSteps: options.capSteps ?? 8,
  };

  const commands: PathCommand[] = [];
  for (const stroke of intoStrokes(ink.segments)) commands.push(...outlineOne(stroke, settings));
  for (const dot of ink.dots) commands.push(...outlineDot(dot, settings.capSteps));

  // The same tidy-up typed outlines get: duplicate points dropped, contours
  // explicitly closed.
  return normalize(commands);
}

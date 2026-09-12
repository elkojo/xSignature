/**
 * What a drawn stroke looks like on the way in.
 *
 * signature_pad smooths raw pointer samples into cubic Béziers and gives each
 * one a width from the pen's velocity. These are those curves — the library's
 * own maths, not ours. Hand-rolling the smoothing would mean reproducing a
 * well-tested algorithm badly.
 */
export interface DrawSegment {
  readonly x0: number;
  readonly y0: number;
  readonly c1x: number;
  readonly c1y: number;
  readonly c2x: number;
  readonly c2y: number;
  readonly x1: number;
  readonly y1: number;
  /** Full stroke width at this segment, in the same units as the points. */
  readonly width: number;
}

/** A tap rather than a stroke: no direction, just a blot. */
export interface DrawDot {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface DrawnInk {
  readonly segments: readonly DrawSegment[];
  readonly dots: readonly DrawDot[];
}

const NUMBER = '(-?\\d*\\.?\\d+(?:e[-+]?\\d+)?)';

/**
 * Read signature_pad's own SVG output back into curves.
 *
 * Going through its SVG rather than its point data is deliberate. `toData()`
 * hands back the raw pointer samples, which would leave us to derive the
 * control points and the velocity widths ourselves — that is exactly the
 * smoothing this app depends on the library for. `toSVG()` is where the library
 * publishes the result of that work: one cubic per segment, with the width it
 * decided on.
 *
 * It is also a pure string, which means the geometry below can be tested
 * without a browser, a canvas or a pointer device.
 */
export function parseSignaturePadSvg(svg: string): DrawnInk {
  const segments: DrawSegment[] = [];
  const dots: DrawDot[] = [];

  const pathPattern = new RegExp(
    `<path[^>]*\\bd="M\\s*${NUMBER}[,\\s]+${NUMBER}\\s*C\\s*${NUMBER}[,\\s]+${NUMBER}\\s+${NUMBER}[,\\s]+${NUMBER}\\s+${NUMBER}[,\\s]+${NUMBER}"[^>]*>`,
    'g',
  );

  for (const match of svg.matchAll(pathPattern)) {
    const width = Number(/stroke-width="([\d.]+)"/.exec(match[0])?.[1] ?? '1');
    const [x0, y0, c1x, c1y, c2x, c2y, x1, y1] = match.slice(1, 9).map(Number);
    if (![x0, y0, c1x, c1y, c2x, c2y, x1, y1, width].every(Number.isFinite)) continue;
    segments.push({ x0, y0, c1x, c1y, c2x, c2y, x1, y1, width });
  }

  const circlePattern = /<circle[^>]*>/g;
  for (const [tag] of svg.matchAll(circlePattern)) {
    const read = (name: string) =>
      Number(new RegExp(`\\b${name}="${NUMBER}"`).exec(tag)?.[1] ?? NaN);
    const x = read('cx');
    const y = read('cy');
    const radius = read('r');
    if ([x, y, radius].every(Number.isFinite) && radius > 0) dots.push({ x, y, radius });
  }

  // A two-point stroke is emitted as a <line>; treat it as a straight cubic so
  // one code path covers everything downstream.
  const linePattern = /<line[^>]*>/g;
  for (const [tag] of svg.matchAll(linePattern)) {
    const read = (name: string) =>
      Number(new RegExp(`\\b${name}="${NUMBER}"`).exec(tag)?.[1] ?? NaN);
    const x0 = read('x1');
    const y0 = read('y1');
    const x1 = read('x2');
    const y1 = read('y2');
    const width = Number(/stroke-width="([\d.]+)"/.exec(tag)?.[1] ?? '1');
    if (![x0, y0, x1, y1, width].every(Number.isFinite)) continue;
    segments.push({
      x0,
      y0,
      c1x: x0 + (x1 - x0) / 3,
      c1y: y0 + (y1 - y0) / 3,
      c2x: x0 + (2 * (x1 - x0)) / 3,
      c2y: y0 + (2 * (y1 - y0)) / 3,
      x1,
      y1,
      width,
    });
  }

  return { segments, dots };
}

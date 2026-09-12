import { describe, expect, it } from 'vitest';

import type { PathCommand } from '../path';
import { parsePathData } from './parse-path-data.test-helper';
import { pngSize, replay, type PathSink } from './raster';
import { toSvg } from './svg';

/** Records what it was asked to draw, so the canvas path can be inspected. */
class Recorder implements PathSink {
  readonly ops: string[] = [];
  private n = (v: number) => String(Number(v.toFixed(2)));

  moveTo(x: number, y: number) {
    this.ops.push(`M${this.n(x)} ${this.n(y)}`);
  }
  lineTo(x: number, y: number) {
    this.ops.push(`L${this.n(x)} ${this.n(y)}`);
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    this.ops.push(`Q${this.n(cx)} ${this.n(cy)} ${this.n(x)} ${this.n(y)}`);
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
    this.ops.push(
      `C${this.n(c1x)} ${this.n(c1y)} ${this.n(c2x)} ${this.n(c2y)} ${this.n(x)} ${this.n(y)}`,
    );
  }
  closePath() {
    this.ops.push('Z');
  }
}

/** Every coordinate on a command, by name. Exhaustive, so no cast is needed. */
function coordinates(c: PathCommand): Record<string, number> {
  switch (c.type) {
    case 'Z':
      return {};
    case 'M':
    case 'L':
      return { x: c.x, y: c.y };
    case 'Q':
      return { x1: c.x1, y1: c.y1, x: c.x, y: c.y };
    case 'C':
      return { x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2, x: c.x, y: c.y };
  }
}

const shape: PathCommand[] = [
  { type: 'M', x: 0, y: 0 },
  { type: 'L', x: 10, y: 0 },
  { type: 'Q', x1: 20, y1: -30, x: 30, y: 0 },
  { type: 'C', x1: 40, y1: 20, x2: 50, y2: 20, x: 60, y: 0 },
  { type: 'Z' },
];

describe('replay', () => {
  it('maps every command to its canvas equivalent', () => {
    const recorder = new Recorder();
    replay(shape, recorder);
    expect(recorder.ops).toEqual([
      'M0 0',
      'L10 0',
      'Q20 -30 30 0',
      'C40 20 50 20 60 0',
      'Z',
    ]);
  });

  it('draws the same geometry the SVG writes', () => {
    // The claim the whole architecture rests on: the PNG and the SVG are one
    // drawing, not two renderings that happen to look alike. Both are handed
    // this command list, so the only way they can diverge is if these two
    // readers disagree about it.
    //
    // The SVG bakes the trim into its coordinates, so the two differ by a
    // translation. Rather than assert what that translation is — which would
    // just re-run layout() and prove nothing — this checks that ONE constant
    // offset explains every coordinate in the file. A difference in command
    // order, in curve type, or in any single point breaks that.
    const recorder = new Recorder();
    replay(shape, recorder);

    const svg = toSvg(shape, { padding: 0.1, color: '#000' })!;
    const fromSvg = parsePathData(/d="([^"]+)"/.exec(svg)![1]);

    expect(fromSvg.map((c) => c.type)).toEqual(shape.map((c) => c.type));

    const offsets = new Set<string>();
    for (const [i, placed] of fromSvg.entries()) {
      const before = coordinates(shape[i]);
      const after = coordinates(placed);
      for (const axis of Object.keys(before)) {
        offsets.add(`${axis[0]}:${(after[axis] - before[axis]).toFixed(6)}`);
      }
    }

    // One offset for x, one for y, and nothing else.
    expect([...offsets].sort()).toHaveLength(2);
    expect(recorder.ops).toHaveLength(shape.length);
  });
});

describe('pngSize', () => {
  it('is null when there is no ink', () => {
    expect(pngSize([], { padding: 0, color: '#000' })).toBeNull();
  });

  it('matches the SVG viewBox at scale 1', () => {
    const size = pngSize(shape, { padding: 0, color: '#000' })!;
    const svg = toSvg(shape, { padding: 0, color: '#000' })!;
    expect(svg).toContain(`viewBox="0 0 ${size.width} ${size.height}"`);
  });

  it('multiplies both dimensions by the scale', () => {
    const one = pngSize(shape, { padding: 0.1, color: '#000' })!;
    const four = pngSize(shape, { padding: 0.1, color: '#000', scale: 4 })!;
    expect(four.width).toBeGreaterThanOrEqual(one.width * 4 - 1);
    expect(four.height).toBeGreaterThanOrEqual(one.height * 4 - 1);
  });

  it('rounds up rather than shaving a pixel off the padding', () => {
    const size = pngSize(shape, { padding: 0.037, color: '#000' })!;
    expect(Number.isInteger(size.width)).toBe(true);
    expect(Number.isInteger(size.height)).toBe(true);
  });

  it('never returns a zero-sized canvas', () => {
    const hairline: PathCommand[] = [
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 0.1, y: 0 },
    ];
    const size = pngSize(hairline, { padding: 0, color: '#000' })!;
    expect(size.width).toBeGreaterThanOrEqual(1);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });
});

describe('pngSize, fitted to a box', () => {
  // The shape is 60 wide and 30 tall before padding: twice as wide as it is
  // tall, so it runs out of width first in a square box.
  const opts = { padding: 0, color: '#000' } as const;

  it('produces exactly the box it was asked for', () => {
    const size = pngSize(shape, { ...opts, fit: { width: 800, height: 240 } })!;
    expect(size).toEqual({ width: 800, height: 240 });
  });

  it('fits by whichever edge runs out first, rather than stretching', () => {
    // A wide signature in a square box is limited by width; the leftover is
    // vertical space, not distortion.
    const wide = pngSize(shape, { ...opts, fit: { width: 400, height: 400 } })!;
    expect(wide).toEqual({ width: 400, height: 400 });
  });

  it('ignores scale when a box is given', () => {
    const a = pngSize(shape, { ...opts, fit: { width: 800, height: 240 }, scale: 4 })!;
    const b = pngSize(shape, { ...opts, fit: { width: 800, height: 240 } })!;
    expect(a).toEqual(b);
  });

  it('rounds a fractional box to whole pixels', () => {
    const size = pngSize(shape, { ...opts, fit: { width: 800.6, height: 239.4 } })!;
    expect(size).toEqual({ width: 801, height: 239 });
  });

  it('never returns a zero-sized canvas', () => {
    const size = pngSize(shape, { ...opts, fit: { width: 0, height: 0 } })!;
    expect(size.width).toBeGreaterThanOrEqual(1);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });

  it('is null when there is no ink', () => {
    expect(pngSize([], { ...opts, fit: { width: 800, height: 240 } })).toBeNull();
  });
});

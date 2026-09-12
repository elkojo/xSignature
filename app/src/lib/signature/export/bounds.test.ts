import { describe, expect, it } from 'vitest';

import type { PathCommand } from '../path';
import { boundsHeight, boundsWidth, pathBounds } from './bounds';

describe('pathBounds', () => {
  it('is null when nothing is drawn', () => {
    expect(pathBounds([])).toBeNull();
  });

  it('bounds straight lines by their corners', () => {
    const box = pathBounds([
      { type: 'M', x: 10, y: 20 },
      { type: 'L', x: 30, y: 5 },
      { type: 'L', x: 15, y: 40 },
      { type: 'Z' },
    ]);
    expect(box).toEqual({ minX: 10, minY: 5, maxX: 30, maxY: 40 });
  });

  it('measures a quadratic where it actually reaches, not where its control point is', () => {
    // A symmetric arc from (0,0) to (100,0) with its control at (50,-100).
    // The curve peaks at t=0.5, which is halfway to the control point: -50.
    const box = pathBounds([
      { type: 'M', x: 0, y: 0 },
      { type: 'Q', x1: 50, y1: -100, x: 100, y: 0 },
    ]);
    expect(box!.minY).toBeCloseTo(-50, 9);
    expect(box!.maxY).toBe(0);
  });

  it('measures a cubic where it actually reaches', () => {
    // Both controls pulled to -100; a cubic reaches three quarters of the way.
    const box = pathBounds([
      { type: 'M', x: 0, y: 0 },
      { type: 'C', x1: 0, y1: -100, x2: 100, y2: -100, x: 100, y: 0 },
    ]);
    expect(box!.minY).toBeCloseTo(-75, 9);
  });

  it('is tighter than the control polygon', () => {
    // The whole point of solving for extrema. The hull of the control points
    // would give -100 here; the curve never goes past -50.
    const arc: PathCommand[] = [
      { type: 'M', x: 0, y: 0 },
      { type: 'Q', x1: 50, y1: -100, x: 100, y: 0 },
    ];
    const hull = Math.min(0, -100, 0);
    expect(pathBounds(arc)!.minY).toBeGreaterThan(hull);
  });

  it('ignores an extremum that falls outside the segment', () => {
    // This curve is monotonic between its endpoints: the maths still produces a
    // root, but at t outside (0,1), where the curve does not exist.
    const box = pathBounds([
      { type: 'M', x: 0, y: 0 },
      { type: 'Q', x1: 10, y1: 10, x: 20, y: 20 },
    ]);
    expect(box).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 20 });
  });

  it('handles a curve that is straight in one axis', () => {
    // Denominator zero in x. Must not divide by it.
    const box = pathBounds([
      { type: 'M', x: 0, y: 0 },
      { type: 'Q', x1: 0, y1: 50, x: 0, y: 100 },
    ]);
    expect(box).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 100 });
  });

  it('returns to the contour start after a close', () => {
    const box = pathBounds([
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 10, y: 10 },
      { type: 'Z' },
      // The pen is back at (0,0), so this curve starts there.
      { type: 'Q', x1: -20, y1: 0, x: -10, y: 0 },
    ]);
    expect(box!.minX).toBeLessThan(-10);
  });

  it('spans every contour', () => {
    const box = pathBounds([
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 1, y: 1 },
      { type: 'M', x: 100, y: 100 },
      { type: 'L', x: 101, y: 101 },
    ]);
    expect(boundsWidth(box!)).toBe(101);
    expect(boundsHeight(box!)).toBe(101);
  });
});

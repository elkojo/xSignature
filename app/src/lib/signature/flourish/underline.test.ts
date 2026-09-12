import { describe, expect, it } from 'vitest';

import { boundsHeight, boundsWidth, pathBounds, type Bounds } from '../export/bounds';
import { underlinePath } from './underline';

/** A signature 400 wide and 100 tall, sitting on a baseline at y = 0. */
const ink: Bounds = { minX: 0, minY: -100, maxX: 400, maxY: 0 };

describe('underlinePath', () => {
  it('draws nothing under nothing', () => {
    expect(underlinePath({ minX: 0, minY: 0, maxX: 0, maxY: 0 })).toEqual([]);
    expect(underlinePath({ minX: 5, minY: 5, maxX: 5, maxY: 90 })).toEqual([]);
  });

  it('sits below the signature, never through it', () => {
    // A flourish overlapping the descenders would read as a strike-through.
    const box = pathBounds(underlinePath(ink))!;
    expect(box.minY).toBeGreaterThan(ink.maxY);
  });

  it('spans the signature and a little beyond at each end', () => {
    const box = pathBounds(underlinePath(ink))!;
    expect(box.minX).toBeLessThan(ink.minX);
    expect(box.maxX).toBeGreaterThan(ink.maxX);
    // But not wildly beyond: this is an underline, not a rule across the page.
    expect(boundsWidth(box)).toBeLessThan(boundsWidth(ink) * 1.25);
  });

  it('is a filled outline, like everything else the pipeline handles', () => {
    // The reason this needed no changes to export/: what comes back is closed
    // contours, not a stroked centreline needing a width applied later.
    const commands = underlinePath(ink);
    expect([...new Set(commands.map((c) => c.type))].sort()).toEqual(['L', 'M', 'Z']);
    expect(commands.filter((c) => c.type === 'M')).toHaveLength(1);
    expect(commands.filter((c) => c.type === 'Z')).toHaveLength(1);
  });

  it('is a tapered stroke rather than a rectangle', () => {
    // The one thing this must not be. A rectangle is the same thickness
    // everywhere; a stroke starts from nothing, swells, and leaves off.
    //
    // Measured in equal-width windows at equal spacing: an uneven window
    // measures the curve's slope as much as its thickness, which is how the
    // first version of this test managed to fail on correct output.
    const commands = underlinePath(ink);
    const box = pathBounds(commands)!;
    const span = boundsWidth(box);

    const profile = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map((t) => {
      const x = box.minX + span * t;
      const ys = commands.flatMap((c) => ('x' in c && Math.abs(c.x - x) < span * 0.01 ? [c.y] : []));
      return ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
    });

    const thickest = Math.max(...profile);
    expect(profile[0]).toBeLessThan(thickest * 0.45);
    expect(profile[profile.length - 1]).toBeLessThan(thickest * 0.45);
    expect(profile[3]).toBeCloseTo(thickest, 5);

    // A rectangle's profile would be flat. This one is not.
    expect(thickest / Math.min(...profile)).toBeGreaterThan(2.5);
  });

  it('is not a straight line: the middle sags below the ends', () => {
    const commands = underlinePath(ink);
    const box = pathBounds(commands)!;
    const centreOfSpan = box.minX + boundsWidth(box) / 2;

    const lowestNear = (x: number) => {
      const ys = commands.flatMap((c) =>
        'x' in c && Math.abs(c.x - x) < boundsWidth(box) * 0.04 ? [c.y] : [],
      );
      return ys.length ? Math.max(...ys) : -Infinity;
    };

    expect(lowestNear(centreOfSpan)).toBeGreaterThan(lowestNear(box.minX + 2));
  });

  it('scales with the signature, so it is one drawing at every size', () => {
    // Proportions, not fixed pixels: a flourish that kept a constant thickness
    // would look like a hairline under a large signature.
    const small = pathBounds(underlinePath(ink))!;
    const bigInk: Bounds = { minX: 0, minY: -300, maxX: 1200, maxY: 0 };
    const big = pathBounds(underlinePath(bigInk))!;

    expect(boundsWidth(big) / boundsWidth(small)).toBeCloseTo(3, 1);
    expect(boundsHeight(big) / boundsHeight(small)).toBeCloseTo(3, 1);
  });

  it('honours the measurements it is given', () => {
    const thin = pathBounds(underlinePath(ink, { thickness: 0.02 }))!;
    const thick = pathBounds(underlinePath(ink, { thickness: 0.12 }))!;
    expect(boundsHeight(thick)).toBeGreaterThan(boundsHeight(thin));

    const close = pathBounds(underlinePath(ink, { gap: 0.02 }))!;
    const far = pathBounds(underlinePath(ink, { gap: 0.4 }))!;
    expect(far.minY).toBeGreaterThan(close.minY);
  });

  it('produces no NaN', () => {
    for (const c of underlinePath(ink)) {
      for (const [key, value] of Object.entries(c)) {
        if (key !== 'type') expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});

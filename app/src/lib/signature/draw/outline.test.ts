import { describe, expect, it } from 'vitest';

import { pathBounds } from '../export/bounds';
import { outlineInk } from './outline';
import type { DrawSegment } from './segments';

/** A straight horizontal run from (0,0) to (length,0) at a constant width. */
const straight = (length: number, width: number): DrawSegment => ({
  x0: 0,
  y0: 0,
  c1x: length / 3,
  c1y: 0,
  c2x: (length * 2) / 3,
  c2y: 0,
  x1: length,
  y1: 0,
  width,
});

describe('outlineInk', () => {
  it('draws nothing from nothing', () => {
    expect(outlineInk({ segments: [], dots: [] })).toEqual([]);
  });

  it('turns a straight stroke into a stadium of the right size', () => {
    // 100 long, 10 wide: the ink reaches 5 above and below the centreline, and
    // the round caps put it 5 beyond each end.
    const commands = outlineInk({ segments: [straight(100, 10)], dots: [] });
    const box = pathBounds(commands)!;

    expect(box.minY).toBeCloseTo(-5, 6);
    expect(box.maxY).toBeCloseTo(5, 6);
    expect(box.minX).toBeCloseTo(-5, 1);
    expect(box.maxX).toBeCloseTo(105, 1);
  });

  it('scales with the width it was given', () => {
    const thin = pathBounds(outlineInk({ segments: [straight(100, 4)], dots: [] }))!;
    const thick = pathBounds(outlineInk({ segments: [straight(100, 12)], dots: [] }))!;
    expect(thick.maxY - thick.minY).toBeCloseTo(12, 6);
    expect(thin.maxY - thin.minY).toBeCloseTo(4, 6);
  });

  it('produces one closed contour per stroke', () => {
    const commands = outlineInk({ segments: [straight(50, 6)], dots: [] });
    expect(commands.filter((c) => c.type === 'M')).toHaveLength(1);
    expect(commands.filter((c) => c.type === 'Z')).toHaveLength(1);
    expect(commands[0].type).toBe('M');
    expect(commands[commands.length - 1].type).toBe('Z');
  });

  it('starts a new contour when the pen is lifted', () => {
    // Two runs that do not meet: two separate outlines, not one joined by a
    // line across the gap.
    const apart: DrawSegment[] = [
      straight(20, 4),
      { ...straight(20, 4), x0: 500, y0: 500, c1x: 507, c1y: 500, c2x: 514, c2y: 500, x1: 520, y1: 500 },
    ];
    const commands = outlineInk({ segments: apart, dots: [] });
    expect(commands.filter((c) => c.type === 'M')).toHaveLength(2);
    expect(commands.filter((c) => c.type === 'Z')).toHaveLength(2);
  });

  it('keeps one contour when the pen is not lifted', () => {
    const joined: DrawSegment[] = [
      straight(20, 4),
      { x0: 20, y0: 0, c1x: 27, c1y: 5, c2x: 34, c2y: 10, x1: 40, y1: 12, width: 4 },
    ];
    expect(outlineInk({ segments: joined, dots: [] }).filter((c) => c.type === 'M')).toHaveLength(1);
  });

  it('turns a tap into a closed circle of the right size', () => {
    const commands = outlineInk({ segments: [], dots: [{ x: 10, y: 20, radius: 3 }] });
    const box = pathBounds(commands)!;
    expect(box.minX).toBeCloseTo(7, 1);
    expect(box.maxX).toBeCloseTo(13, 6);
    expect(box.minY).toBeCloseTo(17, 1);
    expect(box.maxY).toBeCloseTo(23, 1);
  });

  it('produces no NaN, whatever it is given', () => {
    // A stationary pen has no direction to take a normal from. Dividing by that
    // zero length would put NaN in the path data, and an SVG with NaN in a `d`
    // renders as nothing at all.
    const stationary: DrawSegment = {
      x0: 5, y0: 5, c1x: 5, c1y: 5, c2x: 5, c2y: 5, x1: 5, y1: 5, width: 4,
    };
    const commands = outlineInk({ segments: [stationary, straight(10, 4)], dots: [] });
    for (const c of commands) {
      for (const [key, value] of Object.entries(c)) {
        if (key !== 'type') expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it('is denser when asked for a closer fit, and the shape does not move', () => {
    const coarse = outlineInk({ segments: [straight(100, 8)], dots: [] }, { sampleEvery: 20 });
    const fine = outlineInk({ segments: [straight(100, 8)], dots: [] }, { sampleEvery: 1 });

    expect(fine.length).toBeGreaterThan(coarse.length * 2);

    const a = pathBounds(coarse)!;
    const b = pathBounds(fine)!;
    expect(b.maxY - b.minY).toBeCloseTo(a.maxY - a.minY, 6);
  });

  it('fills rather than strokes, so the export pipeline needs no new mode', () => {
    // The point of outlining. Every command is a straight line between offset
    // points, forming closed regions — the same thing glyph outlines are.
    const commands = outlineInk({ segments: [straight(60, 5)], dots: [] });
    const kinds = new Set(commands.map((c) => c.type));
    expect([...kinds].sort()).toEqual(['L', 'M', 'Z']);
  });

  it('widens where the pen slowed, narrowing where it sped up', () => {
    // Velocity-driven width is what makes a drawn signature look drawn. A
    // taper that got lost in normalisation would read as a felt-tip.
    const tapering: DrawSegment[] = [
      { ...straight(40, 12) },
      { x0: 40, y0: 0, c1x: 53, c1y: 0, c2x: 67, c2y: 0, x1: 80, y1: 0, width: 2 },
    ];
    const commands = outlineInk({ segments: tapering, dots: [] });

    const nearStart = commands.filter((c) => 'x' in c && c.x > 5 && c.x < 15).map((c) => ('y' in c ? Math.abs(c.y) : 0));
    const nearEnd = commands.filter((c) => 'x' in c && c.x > 65 && c.x < 75).map((c) => ('y' in c ? Math.abs(c.y) : 0));

    expect(Math.max(...nearStart)).toBeGreaterThan(Math.max(...nearEnd) * 1.5);
  });
});

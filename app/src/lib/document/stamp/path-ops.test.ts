import { describe, expect, it } from 'vitest';

import type { PathCommand } from '../../signature/path';
import { pathOperators, quadraticToCubic } from './path-ops';

const text = (ops: ReturnType<typeof pathOperators>) => ops.map((op) => op.toString()).join('\n');

describe('quadraticToCubic', () => {
  it('draws the identical curve, not an approximation of it', () => {
    const from = { x: 10, y: 40 };
    const control = { x: 55, y: -20 };
    const to = { x: 90, y: 30 };
    const c = quadraticToCubic(from, control, to);

    const quadratic = (t: number, axis: 'x' | 'y') =>
      (1 - t) ** 2 * from[axis] + 2 * (1 - t) * t * control[axis] + t ** 2 * to[axis];

    const cubic = (t: number, axis: 'x' | 'y') => {
      const p1 = axis === 'x' ? c.x1 : c.y1;
      const p2 = axis === 'x' ? c.x2 : c.y2;
      return (
        (1 - t) ** 3 * from[axis] +
        3 * (1 - t) ** 2 * t * p1 +
        3 * (1 - t) * t ** 2 * p2 +
        t ** 3 * to[axis]
      );
    };

    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(cubic(t, 'x')).toBeCloseTo(quadratic(t, 'x'), 10);
      expect(cubic(t, 'y')).toBeCloseTo(quadratic(t, 'y'), 10);
    }
  });

  it('puts both controls two thirds of the way to the quadratic control', () => {
    const c = quadraticToCubic({ x: 0, y: 0 }, { x: 30, y: 60 }, { x: 60, y: 0 });
    expect(c.x1).toBeCloseTo(20, 12);
    expect(c.y1).toBeCloseTo(40, 12);
    expect(c.x2).toBeCloseTo(40, 12);
    expect(c.y2).toBeCloseTo(40, 12);
  });
});

describe('pathOperators', () => {
  it('draws nothing for an empty path, not an empty fill', () => {
    expect(pathOperators([])).toEqual([]);
  });

  it('emits move, line, close and a single fill', () => {
    const ops = pathOperators([
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 10, y: 0 },
      { type: 'L', x: 10, y: 10 },
      { type: 'Z' },
    ]);
    expect(text(ops).split('\n')).toEqual(['0 0 m', '10 0 l', '10 10 l', 'h', 'f']);
  });

  it('fills once for the whole path, so counters are cut out rather than painted over', () => {
    // Two contours: the letter and its hole. Filling each separately would
    // paint the hole solid.
    const ops = pathOperators([
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 20, y: 0 },
      { type: 'Z' },
      { type: 'M', x: 5, y: 5 },
      { type: 'L', x: 10, y: 5 },
      { type: 'Z' },
    ]);
    expect(text(ops).match(/^f$/gm)).toHaveLength(1);
    expect(text(ops).endsWith('f')).toBe(true);
  });

  it('uses nonzero winding, never even-odd', () => {
    const ops = pathOperators([
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 1, y: 1 },
    ]);
    expect(text(ops)).not.toMatch(/f\*/);
  });

  it('converts a quadratic against the point the pen is actually on', () => {
    // The Q's start point is the previous command's end, not the origin —
    // getting this wrong skews every glyph after the first.
    const commands: PathCommand[] = [
      { type: 'M', x: 100, y: 100 },
      { type: 'Q', x1: 130, y1: 160, x: 160, y: 100 },
    ];
    const line = text(pathOperators(commands)).split('\n')[1];
    const expected = quadraticToCubic({ x: 100, y: 100 }, { x: 130, y: 160 }, { x: 160, y: 100 });
    expect(line).toBe(
      `${expected.x1} ${expected.y1} ${expected.x2} ${expected.y2} 160 100 c`,
    );
  });

  it('passes a cubic through untouched', () => {
    const ops = pathOperators([
      { type: 'M', x: 0, y: 0 },
      { type: 'C', x1: 1, y1: 2, x2: 3, y2: 4, x: 5, y: 6 },
    ]);
    expect(text(ops).split('\n')[1]).toBe('1 2 3 4 5 6 c');
  });
});

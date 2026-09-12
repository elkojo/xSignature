import { describe, expect, it } from 'vitest';

import { normalize, toPathData, type PathCommand } from './path';

describe('toPathData', () => {
  it('is empty for no commands', () => {
    expect(toPathData([])).toBe('');
  });

  it('writes each command type', () => {
    const commands: PathCommand[] = [
      { type: 'M', x: 1, y: 2 },
      { type: 'L', x: 3, y: 4 },
      { type: 'C', x1: 5, y1: 6, x2: 7, y2: 8, x: 9, y: 10 },
      { type: 'Q', x1: 11, y1: 12, x: 13, y: 14 },
      { type: 'Z' },
    ];
    expect(toPathData(commands)).toBe('M1 2L3 4C5 6 7 8 9 10Q11 12 13 14Z');
  });

  it('rounds to the requested precision', () => {
    const commands: PathCommand[] = [{ type: 'M', x: 1.23456, y: -9.87654 }];
    expect(toPathData(commands, 2)).toBe('M1.23 -9.88');
    expect(toPathData(commands, 0)).toBe('M1 -10');
  });

  it('drops trailing zeros rather than padding to precision', () => {
    expect(toPathData([{ type: 'L', x: 2.5, y: 3.0 }])).toBe('L2.5 3');
  });

  it('writes negative zero as zero', () => {
    // Rounding a small negative number gives -0, which serializes as "-0" and
    // costs a character in every glyph that touches the baseline from below.
    expect(toPathData([{ type: 'M', x: -0.001, y: 0 }])).toBe('M0 0');
  });
});

describe('normalize', () => {
  it('keeps a path that is already clean', () => {
    const commands: PathCommand[] = [
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 10, y: 0 },
      { type: 'L', x: 10, y: 10 },
      { type: 'Z' },
    ];
    expect(normalize(commands)).toEqual(commands);
  });

  it('drops a line to the point the pen is already on', () => {
    expect(
      normalize([
        { type: 'M', x: 5, y: 5 },
        { type: 'L', x: 5, y: 5 },
        { type: 'L', x: 9, y: 5 },
      ]),
    ).toEqual([
      { type: 'M', x: 5, y: 5 },
      { type: 'L', x: 9, y: 5 },
    ]);
  });

  it('drops a curve that collapses to a point, and the empty contour with it', () => {
    // Nothing is drawn here, so nothing should survive — a lone moveto marks no
    // ink and only costs bytes.
    expect(
      normalize([
        { type: 'M', x: 1, y: 1 },
        { type: 'Q', x1: 1, y1: 1, x: 1, y: 1 },
        { type: 'C', x1: 1, y1: 1, x2: 1, y2: 1, x: 1, y: 1 },
      ]),
    ).toEqual([]);
  });

  it('keeps a curve that returns to its start but bulges on the way', () => {
    // Same endpoints, real geometry between them. Dropping this would delete a
    // visible loop — the reason the check looks at control points too.
    const loop: PathCommand[] = [
      { type: 'M', x: 0, y: 0 },
      { type: 'C', x1: 10, y1: 10, x2: -10, y2: 10, x: 0, y: 0 },
    ];
    expect(normalize(loop)).toEqual([...loop, { type: 'Z' }]);
  });

  it('closes a contour that comes back to where it started', () => {
    expect(
      normalize([
        { type: 'M', x: 0, y: 0 },
        { type: 'L', x: 4, y: 0 },
        { type: 'L', x: 0, y: 0 },
      ]),
    ).toEqual([
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 4, y: 0 },
      { type: 'L', x: 0, y: 0 },
      { type: 'Z' },
    ]);
  });

  it('leaves an open contour open', () => {
    // A drawn stroke that ends elsewhere is not a region, and closing it would
    // invent a line back to the start that nobody drew.
    const stroke: PathCommand[] = [
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 4, y: 7 },
    ];
    expect(normalize(stroke)).toEqual(stroke);
  });

  it('closes each contour before the next one begins', () => {
    const two = normalize([
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 1, y: 1 },
      { type: 'L', x: 0, y: 0 },
      { type: 'M', x: 8, y: 8 },
      { type: 'L', x: 9, y: 9 },
      { type: 'L', x: 8, y: 8 },
    ]);
    expect(two.filter((c) => c.type === 'Z')).toHaveLength(2);
    expect(two[3]).toEqual({ type: 'Z' });
  });

  it('does not double up an existing close', () => {
    const closed: PathCommand[] = [
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 2, y: 0 },
      { type: 'L', x: 0, y: 0 },
      { type: 'Z' },
    ];
    expect(normalize(closed).filter((c) => c.type === 'Z')).toHaveLength(1);
  });

  it('is empty for no commands', () => {
    expect(normalize([])).toEqual([]);
  });
});

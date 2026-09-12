import { describe, expect, it } from 'vitest';

import { parseSignaturePadSvg } from './segments';

/**
 * Captured from signature_pad 5.1.4's own `toSVG()`, via scripts/draw-check.html.
 *
 * Real output rather than something written to match the parser: the whole risk
 * in this module is assuming a format the library does not actually emit.
 */
const REAL = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 600 220" width="600" height="220"><path d="M 40.000,120.000 C 44.463,123.063 44.500,123.006 49.000,126.012" stroke-width="5.067" stroke="#12130f" fill="none" stroke-linecap="round"></path><path d="M 49.000,126.012 C 53.430,128.972 53.463,128.912 58.000,131.699" stroke-width="4.804" stroke="#12130f" fill="none" stroke-linecap="round"></path><path d="M 58.000,131.699 C 62.408,134.406 62.430,134.342 67.000,136.751" stroke-width="4.820" stroke="#12130f" fill="none" stroke-linecap="round"></path></svg>`;

describe('parseSignaturePadSvg', () => {
  it('reads every curve the library emitted', () => {
    const ink = parseSignaturePadSvg(REAL);
    expect(ink.segments).toHaveLength(3);
    expect(ink.dots).toHaveLength(0);
  });

  it('reads the control points in the right order', () => {
    const [first] = parseSignaturePadSvg(REAL).segments;
    expect(first).toEqual({
      x0: 40,
      y0: 120,
      c1x: 44.463,
      c1y: 123.063,
      c2x: 44.5,
      c2y: 123.006,
      x1: 49,
      y1: 126.012,
      width: 5.067,
    });
  });

  it('keeps each segment its own width', () => {
    // The taper is the whole reason for going through the library's SVG. A
    // parser that dropped stroke-width would silently flatten it.
    const widths = parseSignaturePadSvg(REAL).segments.map((s) => s.width);
    expect(widths).toEqual([5.067, 4.804, 4.82]);
  });

  it('joins the curves end to start, so they read as one stroke', () => {
    const [a, b] = parseSignaturePadSvg(REAL).segments;
    expect([a.x1, a.y1]).toEqual([b.x0, b.y0]);
  });

  it('finds nothing in an empty drawing', () => {
    const empty = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 220"></svg>';
    expect(parseSignaturePadSvg(empty)).toEqual({ segments: [], dots: [] });
  });

  it('reads a tap as a dot', () => {
    const tap = `<svg><circle r="2.15" cx="120" cy="80" fill="#12130f"></circle></svg>`;
    expect(parseSignaturePadSvg(tap).dots).toEqual([{ x: 120, y: 80, radius: 2.15 }]);
  });

  it('turns a two-point stroke, which the library emits as a line, into a curve', () => {
    const line = `<svg><line x1="10" y1="10" x2="40" y2="10" stroke-width="3" stroke="#000"></line></svg>`;
    const [segment] = parseSignaturePadSvg(line).segments;
    expect(segment.x0).toBe(10);
    expect(segment.x1).toBe(40);
    expect(segment.width).toBe(3);
    // Control points along the straight line, so downstream needs no special case.
    expect(segment.c1x).toBeCloseTo(20, 6);
    expect(segment.c2x).toBeCloseTo(30, 6);
  });

  it('skips a curve the library marked as unusable', () => {
    // signature_pad guards against NaN control points and omits those paths,
    // but a malformed one must not become NaN geometry here either.
    const broken = `<svg><path d="M 1,2 C NaN,3 4,5 6,7" stroke-width="2"></path></svg>`;
    expect(parseSignaturePadSvg(broken).segments).toHaveLength(0);
  });

  it('ignores a zero-radius dot', () => {
    expect(parseSignaturePadSvg('<svg><circle r="0" cx="1" cy="2"></circle></svg>').dots).toEqual([]);
  });
});

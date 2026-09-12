import { describe, expect, it } from 'vitest';

import { applyPressure, pressureVaries, type PressurePoint } from './pressure';
import type { DrawSegment, DrawnInk } from './segments';

const segment = (x: number, width: number): DrawSegment => ({
  x0: x, y0: 0, c1x: x + 3, c1y: 0, c2x: x + 7, c2y: 0, x1: x + 10, y1: 0, width,
});

const ink: DrawnInk = {
  segments: [segment(0, 4), segment(100, 4)],
  dots: [{ x: 200, y: 0, radius: 3 }],
};

const point = (x: number, pressure: number): PressurePoint => ({ x, y: 0, pressure });

describe('pressureVaries', () => {
  it('is false for a mouse, which reports one number forever', () => {
    // Chrome reports 0.5 for every mouse sample. Treating that as pressure
    // would rescale the whole signature for no reason.
    expect(pressureVaries([point(0, 0.5), point(10, 0.5), point(20, 0.5)])).toBe(false);
  });

  it('is false when every sample reads zero', () => {
    expect(pressureVaries([point(0, 0), point(10, 0)])).toBe(false);
  });

  it('is true when a stylus actually varies', () => {
    expect(pressureVaries([point(0, 0.2), point(10, 0.9)])).toBe(true);
  });

  it('ignores a difference too small to mean anything', () => {
    expect(pressureVaries([point(0, 0.5), point(10, 0.52)])).toBe(false);
  });

  it('is false for a single sample, or none', () => {
    expect(pressureVaries([point(0, 0.9)])).toBe(false);
    expect(pressureVaries([])).toBe(false);
  });
});

describe('applyPressure', () => {
  it('leaves a mouse drawing exactly as it was', () => {
    // The promise that makes this safe to apply unconditionally: with no
    // pressure information, nothing changes at all.
    const flat = [point(5, 0.5), point(105, 0.5), point(200, 0.5)];
    expect(applyPressure(ink, flat)).toBe(ink);
  });

  it('widens where the pen pressed harder', () => {
    const stylus = [point(5, 1), point(105, 0.1), point(200, 0.5)];
    const out = applyPressure(ink, stylus);
    expect(out.segments[0].width).toBeGreaterThan(4);
    expect(out.segments[1].width).toBeLessThan(4);
  });

  it('leaves a neutral sample alone', () => {
    // Half pressure is the hinge: velocity keeps the width it worked out.
    const out = applyPressure(ink, [point(5, 0.5), point(105, 0.5), point(200, 0.95)]);
    expect(out.segments[0].width).toBeCloseTo(4, 6);
  });

  it('scales by the nearest sample, not by sample order', () => {
    // Positions are the one thing the curves and the point data certainly
    // agree on; counts and indices do not line up between them.
    const outOfOrder = [point(200, 0.5), point(105, 1), point(5, 0.1)];
    const out = applyPressure(ink, outOfOrder);
    expect(out.segments[0].width).toBeLessThan(4);
    expect(out.segments[1].width).toBeGreaterThan(4);
  });

  it('weights taps too', () => {
    const out = applyPressure(ink, [point(5, 0.5), point(105, 0.5), point(200, 1)]);
    expect(out.dots[0].radius).toBeGreaterThan(3);
  });

  it('respects the strength it is given', () => {
    const stylus = [point(5, 1), point(105, 0.5), point(200, 0.5)];
    const gentle = applyPressure(ink, stylus, { strength: 0.2 });
    const strong = applyPressure(ink, stylus, { strength: 1.6 });
    expect(strong.segments[0].width).toBeGreaterThan(gentle.segments[0].width);
  });

  it('never produces a width at or below zero', () => {
    // A clamp, not an accident: a zero-width segment collapses the outline and
    // a negative one turns it inside out.
    const out = applyPressure(ink, [point(5, 0), point(105, 1), point(200, 0.5)], { strength: 5 });
    for (const s of out.segments) expect(s.width).toBeGreaterThan(0);
    for (const d of out.dots) expect(d.radius).toBeGreaterThan(0);
  });

  it('survives a sample with no usable pressure reading', () => {
    const out = applyPressure(ink, [point(5, NaN), point(105, 0.1), point(200, 0.9)]);
    for (const s of out.segments) expect(Number.isFinite(s.width)).toBe(true);
  });
});

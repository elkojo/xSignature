import { describe, expect, it } from 'vitest';

import {
  AMPLE_ABOVE_DPI,
  describeDpi,
  pixelsNeededFor,
  resolutionFor,
  SOFT_BELOW_DPI,
} from './resolution';

describe('resolutionFor', () => {
  it('computes dots per inch from pixels over points', () => {
    // 144 pixels across one inch of page is 144 dpi.
    expect(resolutionFor(144, 72).dpi).toBeCloseTo(144, 9);
  });

  it('calls a 4x copy ample where a signature actually goes', () => {
    // What "Copy PNG at 4x" produces, placed about two inches wide.
    const placed = 2 * 72;
    const { sharpness, dpi } = resolutionFor(2280, placed);
    expect(dpi).toBeGreaterThan(1000);
    expect(sharpness).toBe('ample');
  });

  it('calls a small picture stretched wide soft', () => {
    // A 1x copy dragged across half a page.
    expect(resolutionFor(285, 4 * 72).sharpness).toBe('soft');
  });

  it('puts the boundaries where the constants say', () => {
    expect(resolutionFor(SOFT_BELOW_DPI - 1, 72).sharpness).toBe('soft');
    expect(resolutionFor(SOFT_BELOW_DPI, 72).sharpness).toBe('adequate');
    expect(resolutionFor(AMPLE_ABOVE_DPI - 1, 72).sharpness).toBe('adequate');
    expect(resolutionFor(AMPLE_ABOVE_DPI, 72).sharpness).toBe('ample');
  });

  it('says nothing is wrong while the placement has no size yet', () => {
    // Happens mid-drag; a warning that flickers is worse than none.
    expect(resolutionFor(1000, 0).sharpness).toBe('ample');
    expect(resolutionFor(0, 100).sharpness).toBe('ample');
  });

  it('gets worse as the same picture is placed wider', () => {
    const narrow = resolutionFor(600, 100).dpi;
    const wide = resolutionFor(600, 400).dpi;
    expect(wide).toBeLessThan(narrow);
  });
});

describe('describeDpi', () => {
  it('rounds the way somebody would say it', () => {
    expect(describeDpi(1147)).toBe('1100 dpi');
    expect(describeDpi(94)).toBe('90 dpi');
    expect(describeDpi(288)).toBe('290 dpi');
  });

  it('has a sentence for a vector, which has no dpi at all', () => {
    expect(describeDpi(Infinity)).toBe('any size');
  });
});

describe('pixelsNeededFor', () => {
  it('says what width would print cleanly, so the advice can be acted on', () => {
    // Two inches at 300 dpi is 600 pixels.
    expect(pixelsNeededFor(2 * 72)).toBe(600);
  });

  it('always rounds up, so the answer is never a pixel short', () => {
    expect(pixelsNeededFor(100)).toBeGreaterThanOrEqual((300 * 100) / 72);
  });
});

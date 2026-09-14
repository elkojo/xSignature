import { describe, expect, it } from 'vitest';

import {
  displayedSize,
  fitInside,
  normalizeRotation,
  placementMatrix,
  type Matrix,
  type PageGeometry,
  type Rotation,
} from './placement';

/** Apply a `cm` matrix the way a PDF viewer would. */
function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  const [a, b, c, d, e, f] = m;
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

/**
 * Where a point in PDF user space appears on screen.
 *
 * This is written out independently of the module under test — the same
 * relationship derived from the other end — so a mistake in one does not agree
 * with a matching mistake in the other.
 */
function toDisplay(page: PageGeometry, p: { x: number; y: number }): { x: number; y: number } {
  const ux = p.x - page.x;
  const uy = p.y - page.y;
  const { width: pw, height: ph } = page;
  switch (page.rotation) {
    case 0:
      return { x: ux, y: ph - uy };
    case 90:
      return { x: uy, y: ux };
    case 180:
      return { x: pw - ux, y: uy };
    case 270:
      return { x: ph - uy, y: pw - ux };
  }
}

const A4 = (rotation: Rotation, offset = { x: 0, y: 0 }): PageGeometry => ({
  x: offset.x,
  y: offset.y,
  width: 595,
  height: 842,
  rotation,
});

describe('normalizeRotation', () => {
  it('treats a missing /Rotate as upright', () => {
    expect(normalizeRotation(undefined)).toBe(0);
  });

  it('wraps past a full turn', () => {
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(360)).toBe(0);
  });

  it('brings a negative rotation round the right way', () => {
    // Real files carry /Rotate -90, and it means the same as 270.
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(-180)).toBe(180);
  });
});

describe('displayedSize', () => {
  it('leaves an upright page alone', () => {
    expect(displayedSize(A4(0))).toEqual({ width: 595, height: 842 });
  });

  it('swaps the sides on a quarter turn', () => {
    expect(displayedSize(A4(90))).toEqual({ width: 842, height: 595 });
    expect(displayedSize(A4(270))).toEqual({ width: 842, height: 595 });
  });

  it('does not swap on a half turn', () => {
    expect(displayedSize(A4(180))).toEqual({ width: 595, height: 842 });
  });
});

describe('fitInside', () => {
  const box = { x: 10, y: 20, width: 200, height: 100 };

  it('centres a wide signature vertically, using the full width', () => {
    const fit = fitInside(box, 400, 100); // 4:1 into 2:1 — width binds
    expect(fit.scale).toBe(0.5);
    expect(fit.width).toBe(200);
    expect(fit.height).toBe(50);
    expect(fit.x).toBe(10);
    expect(fit.y).toBe(45); // 20 + (100 - 50) / 2
  });

  it('centres a tall signature horizontally, using the full height', () => {
    const fit = fitInside(box, 100, 200); // height binds
    expect(fit.scale).toBe(0.5);
    expect(fit.height).toBe(100);
    expect(fit.x).toBe(85); // 10 + (200 - 50) / 2
    expect(fit.y).toBe(20);
  });

  it('never distorts — one scale for both axes', () => {
    const fit = fitInside(box, 333, 77);
    expect(fit.width / 333).toBeCloseTo(fit.height / 77, 12);
  });

  it('survives an empty signature instead of dividing by zero', () => {
    expect(fitInside(box, 0, 0)).toMatchObject({ width: 0, height: 0, scale: 0 });
  });
});

describe('placementMatrix', () => {
  const signature = { width: 400, height: 100 };
  // A box in the lower right of the displayed page — deliberately not
  // symmetric, so a mirrored result cannot pass by accident.
  const rect = { x: 0.5, y: 0.7, width: 0.4, height: 0.1 };

  const rotations: Rotation[] = [0, 90, 180, 270];

  it.each(rotations)('puts the ink where it was dropped, at /Rotate %i', (rotation) => {
    const page = A4(rotation);
    const view = displayedSize(page);
    const matrix = placementMatrix(page, rect, signature);

    const expected = fitInside(
      {
        x: rect.x * view.width,
        y: rect.y * view.height,
        width: rect.width * view.width,
        height: rect.height * view.height,
      },
      signature.width,
      signature.height,
    );

    // The signature's own top-left must appear at the fitted box's top-left,
    // and its bottom-right at the fitted box's bottom-right. That pins
    // position, scale, rotation and handedness all at once.
    const topLeft = toDisplay(page, apply(matrix, 0, 0));
    expect(topLeft.x).toBeCloseTo(expected.x, 9);
    expect(topLeft.y).toBeCloseTo(expected.y, 9);

    const bottomRight = toDisplay(page, apply(matrix, signature.width, signature.height));
    expect(bottomRight.x).toBeCloseTo(expected.x + expected.width, 9);
    expect(bottomRight.y).toBeCloseTo(expected.y + expected.height, 9);
  });

  it.each(rotations)('keeps the writing the right way round at /Rotate %i', (rotation) => {
    const page = A4(rotation);
    const matrix = placementMatrix(page, rect, signature);

    // Moving right along the signature must move right across the screen, and
    // moving down it must move down the screen. Without this an upside-down
    // placement still lands in the right rectangle.
    const origin = toDisplay(page, apply(matrix, 0, 0));
    const right = toDisplay(page, apply(matrix, 10, 0));
    const down = toDisplay(page, apply(matrix, 0, 10));

    expect(right.x).toBeGreaterThan(origin.x);
    expect(right.y).toBeCloseTo(origin.y, 9);
    expect(down.y).toBeGreaterThan(origin.y);
    expect(down.x).toBeCloseTo(origin.x, 9);
  });

  it.each(rotations)('flips exactly once at /Rotate %i', (rotation) => {
    const [a, b, c, d] = placementMatrix(A4(rotation), rect, signature);
    // y-down ink onto a y-up page is one reflection, whatever the rotation.
    expect(a * d - b * c).toBeLessThan(0);
  });

  it('respects a crop box that does not start at the origin', () => {
    // A page cropped out of a larger sheet. Ignoring the offset puts the
    // signature off the visible area entirely.
    const page: PageGeometry = { x: 100, y: 250, width: 595, height: 842, rotation: 0 };
    const matrix = placementMatrix(page, { x: 0, y: 0, width: 1, height: 1 }, signature);
    const topLeft = apply(matrix, 0, 0);

    expect(topLeft.x).toBeGreaterThanOrEqual(100);
    expect(topLeft.y).toBeLessThanOrEqual(250 + 842);
    expect(toDisplay(page, topLeft).x).toBeCloseTo(0, 9);
  });
});

import { describe, expect, it } from 'vitest';

import {
  appearanceMatrix,
  concat,
  displayedSize,
  fitInside,
  normalizeRotation,
  placementMatrix,
  unitSquareToBox,
  widgetRect,
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

describe('concat and unitSquareToBox', () => {
  const identity: Matrix = [1, 0, 0, 1, 0, 0];

  it('leaves a matrix alone when combined with the identity', () => {
    const m: Matrix = [2, 3, 4, 5, 6, 7];
    expect(concat(identity, m)).toEqual(m);
    expect(concat(m, identity)).toEqual(m);
  });

  it('applies the first matrix first', () => {
    const shiftThenDouble = concat([1, 0, 0, 1, 10, 0], [2, 0, 0, 2, 0, 0]);
    // (0,0) shifted to (10,0), then doubled, is (20,0) — not (10,0).
    expect(apply(shiftThenDouble, 0, 0)).toEqual({ x: 20, y: 0 });
  });

  it('turns the image square into the box, top row first', () => {
    const m = unitSquareToBox(100, 40);
    // An image's own (0,1) is its top-left; in ink space that is (0,0).
    expect(apply(m, 0, 1)).toEqual({ x: 0, y: 0 });
    expect(apply(m, 1, 0)).toEqual({ x: 100, y: 40 });
  });

  it('puts an image exactly where outlines of the same size would go', () => {
    // The property that matters: a pasted picture and a pasted outline of the
    // same proportions land on the same spot on the same page.
    const page = A4(90);
    const rect = { x: 0.3, y: 0.6, width: 0.4, height: 0.1 };
    const ink = { width: 400, height: 100 };

    const outlines = placementMatrix(page, rect, ink);
    const image = concat(unitSquareToBox(ink.width, ink.height), outlines);

    // The image's top-left corner against the outline box's top-left corner.
    expect(apply(image, 0, 1).x).toBeCloseTo(apply(outlines, 0, 0).x, 9);
    expect(apply(image, 0, 1).y).toBeCloseTo(apply(outlines, 0, 0).y, 9);
    // And its bottom-right against theirs.
    expect(apply(image, 1, 0).x).toBeCloseTo(apply(outlines, ink.width, ink.height).x, 9);
    expect(apply(image, 1, 0).y).toBeCloseTo(apply(outlines, ink.width, ink.height).y, 9);
  });
});

describe('widgetRect', () => {
  const plain = { x: 0, y: 0, width: 400, height: 800, rotation: 0 } as const;
  const box = { x: 0.25, y: 0.5, width: 0.5, height: 0.25 };

  it('turns a dragged box into page coordinates, lower-left first', () => {
    const [x1, y1, x2, y2] = widgetRect(plain, box);

    // The box sits 0.5 to 0.75 of the way down the display, and user space
    // counts the other way: 800 - 600 = 200 at the bottom, 800 - 400 = 400 up.
    expect([x1, y1, x2, y2]).toEqual([100, 200, 300, 400]);
    expect(x1).toBeLessThan(x2);
    expect(y1).toBeLessThan(y2);
  });

  it('carries the crop box offset, for a page cropped from a larger sheet', () => {
    const cropped = { ...plain, x: 20, y: 30 };
    const [x1, y1, x2, y2] = widgetRect(cropped, box);

    expect([x1, y1, x2, y2]).toEqual([120, 230, 320, 430]);
  });

  it('gives a lower-left-first rectangle at every rotation', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const [x1, y1, x2, y2] = widgetRect({ ...plain, rotation }, box);

      expect(x1).toBeLessThan(x2);
      expect(y1).toBeLessThan(y2);
      // Still inside the page, whichever way it is stored.
      expect(x1).toBeGreaterThanOrEqual(0);
      expect(y1).toBeGreaterThanOrEqual(0);
      expect(x2).toBeLessThanOrEqual(plain.width);
      expect(y2).toBeLessThanOrEqual(plain.height);
    }
  });

  it('swaps the sides on a quarter turn', () => {
    // The page is displayed 800 wide by 400 tall, so a box that is wide on
    // screen is tall in the page's own coordinates.
    const turned = widgetRect({ ...plain, rotation: 90 }, box);
    const width = turned[2] - turned[0];
    const height = turned[3] - turned[1];

    expect(height).toBeCloseTo(0.5 * 800, 6);
    expect(width).toBeCloseTo(0.25 * 400, 6);
  });

  it('agrees with where the signature itself is placed', () => {
    // The block's rectangle and the ink's matrix have to describe the same
    // spot, or a visible signature sits somewhere its own outline does not.
    for (const rotation of [0, 90, 180, 270] as const) {
      const page = { ...plain, rotation };
      const [x1, y1, x2, y2] = widgetRect(page, box);
      // A square signature exactly filling the box: its matrix translation is
      // one of the box's corners in user space.
      const [, , , , e, f] = placementMatrix(page, box, { width: 1, height: 1 });

      expect(e).toBeGreaterThanOrEqual(x1 - 0.0001);
      expect(e).toBeLessThanOrEqual(x2 + 0.0001);
      expect(f).toBeGreaterThanOrEqual(y1 - 0.0001);
      expect(f).toBeLessThanOrEqual(y2 + 0.0001);
    }
  });
});

describe('widgetRect, round-tripped', () => {
  /** Map a page-space rectangle back to fractions of the displayed page. */
  function backToFractions(
    page: PageGeometry,
    [x1, y1, x2, y2]: readonly [number, number, number, number],
  ) {
    const { width: pw, height: ph } = page;
    const view = displayedSize(page);
    const box =
      page.rotation === 0
        ? { x: x1 - page.x, y: ph - (y2 - page.y), w: x2 - x1, h: y2 - y1 }
        : page.rotation === 90
          ? { x: y1 - page.y, y: x1 - page.x, w: y2 - y1, h: x2 - x1 }
          : page.rotation === 180
            ? { x: pw - (x2 - page.x), y: y1 - page.y, w: x2 - x1, h: y2 - y1 }
            : { x: ph - (y2 - page.y), y: pw - (x2 - page.x), w: y2 - y1, h: x2 - x1 };

    return { x: box.x / view.width, y: box.y / view.height, width: box.w / view.width };
  }

  it('puts the block where the reader dragged it, at every rotation', () => {
    // The property that matters and the one hardest to see from the code: a
    // rectangle dragged on the displayed page has to come back to the same
    // place on the displayed page, whichever way the page is stored. Verified
    // against rendered output once; kept honest here.
    const asked = { x: 0.55, y: 0.8, width: 0.4, height: 0.06 };

    for (const rotation of [0, 90, 180, 270] as const) {
      const page: PageGeometry = { x: 0, y: 0, width: 595, height: 842, rotation };
      const got = backToFractions(page, widgetRect(page, asked));

      expect(got.x).toBeCloseTo(asked.x, 6);
      expect(got.y).toBeCloseTo(asked.y, 6);
      expect(got.width).toBeCloseTo(asked.width, 6);
    }
  });

  it('round-trips on a page cropped from a larger sheet too', () => {
    const asked = { x: 0.3, y: 0.25, width: 0.2, height: 0.1 };
    const page: PageGeometry = { x: 24, y: 36, width: 500, height: 700, rotation: 90 };
    const got = backToFractions(page, widgetRect(page, asked));

    expect(got.x).toBeCloseTo(asked.x, 6);
    expect(got.y).toBeCloseTo(asked.y, 6);
  });
});

describe('appearanceMatrix', () => {
  it('is the identity on a page that is not turned', () => {
    expect(appearanceMatrix(0)).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('turns the block against the page, so it reads upright', () => {
    // A reader turns the whole page to display it, annotations included. The
    // appearance has to be turned the other way first or it arrives on its side.
    for (const rotation of [90, 180, 270] as const) {
      const [a, b, c, d] = appearanceMatrix(rotation);

      // A pure rotation: unit length, and no reflection.
      expect(a * a + b * b).toBeCloseTo(1, 6);
      expect(c * c + d * d).toBeCloseTo(1, 6);
      expect(a * d - b * c).toBeCloseTo(1, 6);
    }
  });

  it('takes four quarter turns to get back where it started', () => {
    const once = appearanceMatrix(90);
    const twice = concat(once, once);
    const fourTimes = concat(twice, twice);

    fourTimes.forEach((value, index) => {
      expect(value).toBeCloseTo(appearanceMatrix(0)[index], 6);
    });
  });
});

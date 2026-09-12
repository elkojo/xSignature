import { describe, expect, it } from 'vitest';

import { layout } from './layout';

const ink = { minX: 100, minY: -40, maxX: 300, maxY: 60 };

describe('layout', () => {
  it('moves the ink to the origin when there is no padding', () => {
    const box = layout(ink, { padding: 0 });
    expect(box).toEqual({ width: 200, height: 100, translateX: -100, translateY: 40 });
  });

  it('adds the same margin on all four sides', () => {
    const box = layout(ink, { padding: 0.1 });
    const margin = 100 * 0.1;
    expect(box.width).toBe(200 + margin * 2);
    expect(box.height).toBe(100 + margin * 2);
    expect(box.translateX).toBe(margin - 100);
    expect(box.translateY).toBe(margin + 40);
  });

  it('takes the margin from the ink height, not its width', () => {
    // A signature is a line of writing. Scaling the margin with the width would
    // give a long name a margin as long as itself.
    const wide = layout({ minX: 0, minY: 0, maxX: 1000, maxY: 100 }, { padding: 0.1 });
    const tall = layout({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, { padding: 0.1 });
    expect(wide.height - 100).toBe(tall.height - 100);
  });

  it('places the ink so that padding actually surrounds it', () => {
    const padding = 0.25;
    const box = layout(ink, { padding });
    const margin = 100 * padding;

    // Ink corners, after the translate.
    expect(ink.minX + box.translateX).toBeCloseTo(margin, 9);
    expect(ink.minY + box.translateY).toBeCloseTo(margin, 9);
    expect(ink.maxX + box.translateX).toBeCloseTo(box.width - margin, 9);
    expect(ink.maxY + box.translateY).toBeCloseTo(box.height - margin, 9);
  });
});

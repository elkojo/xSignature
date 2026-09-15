import { describe, expect, it } from 'vitest';

import { detailLines, fitCentred, layoutBlock } from './layout';

const wide = { width: 200, height: 60 };

describe('fitCentred', () => {
  it('keeps proportions rather than filling the box', () => {
    // A signature stretched to fill a box is a different signature. Nothing
    // else in this app stretches ink, and neither does this.
    const box = fitCentred({ width: 100, height: 20 }, { x: 0, y: 0, width: 100, height: 100 });

    expect(box.width / box.height).toBeCloseTo(5, 6);
    expect(box.width).toBe(100);
    expect(box.height).toBe(20);
  });

  it('centres what is left over', () => {
    const box = fitCentred({ width: 10, height: 10 }, { x: 0, y: 0, width: 100, height: 40 });

    expect(box.height).toBe(40);
    expect(box.width).toBe(40);
    expect(box.x).toBe(30);
    expect(box.y).toBe(0);
  });

  it('gives back nothing for a picture or a box with no size', () => {
    const empty = { x: 5, y: 5, width: 0, height: 0 };
    expect(fitCentred({ width: 0, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toEqual(empty);
    expect(fitCentred({ width: 10, height: 10 }, { x: 5, y: 5, width: 0, height: 10 })).toEqual(empty);
  });
});

describe('layoutBlock', () => {
  it('gives the signature the whole width when there is nothing to say', () => {
    // A block holding only a signature should look like a signature, not like
    // one squeezed into half a box.
    const withText = layoutBlock({ ...wide, signature: { width: 4, height: 1 }, lines: 3 });
    const without = layoutBlock({ ...wide, signature: { width: 4, height: 1 }, lines: 0 });

    expect(without.signature.width).toBeGreaterThan(withText.signature.width);
    expect(without.textColumn).toBeNull();
    expect(without.baselines).toHaveLength(0);
  });

  it('keeps the two columns apart', () => {
    const laid = layoutBlock({ ...wide, signature: { width: 4, height: 1 }, lines: 2 });

    const signatureRight = laid.signature.x + laid.signature.width;
    expect(laid.textColumn!.x).toBeGreaterThanOrEqual(signatureRight);
  });

  it('centres the lines vertically instead of hanging them from the top', () => {
    // With one or two lines beside a signature, top alignment reads as a bug.
    const one = layoutBlock({ ...wide, signature: { width: 4, height: 1 }, lines: 1, fontSize: 8 });
    const middle = wide.height / 2;

    expect(one.baselines[0].y).toBeGreaterThan(middle - 8);
    expect(one.baselines[0].y).toBeLessThan(middle + 8);
  });

  it('spaces the lines evenly and in order', () => {
    const laid = layoutBlock({ ...wide, signature: { width: 4, height: 1 }, lines: 4, fontSize: 7 });
    const gaps = laid.baselines.slice(1).map((line, i) => line.y - laid.baselines[i].y);

    expect(laid.baselines).toHaveLength(4);
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 6);
    expect(gaps[0]).toBeGreaterThan(7);
  });

  it('puts the logo below the signature rather than over it', () => {
    const laid = layoutBlock({
      ...wide,
      signature: { width: 4, height: 1 },
      logo: { width: 2, height: 1 },
      lines: 0,
    });

    expect(laid.logo).not.toBeNull();
    expect(laid.logo!.y).toBeGreaterThanOrEqual(laid.signature.y + laid.signature.height);
  });

  it('gives the signature more room when there is no logo', () => {
    const base = { ...wide, signature: { width: 1, height: 1 }, lines: 0 } as const;
    const alone = layoutBlock(base);
    const shared = layoutBlock({ ...base, logo: { width: 1, height: 1 } });

    expect(alone.signature.height).toBeGreaterThan(shared.signature.height);
    expect(shared.logo).not.toBeNull();
  });

  it('stays inside the block, padding included', () => {
    const laid = layoutBlock({
      ...wide,
      signature: { width: 1, height: 10 },
      logo: { width: 3, height: 1 },
      lines: 3,
    });

    for (const box of [laid.signature, laid.logo!, laid.textColumn!]) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(wide.width);
      expect(box.y + box.height).toBeLessThanOrEqual(wide.height + 0.0001);
    }
  });

  it('survives a block too small to hold anything', () => {
    const laid = layoutBlock({ width: 4, height: 4, signature: { width: 4, height: 1 }, lines: 2 });

    expect(Number.isFinite(laid.signature.width)).toBe(true);
    expect(laid.signature.width).toBeGreaterThanOrEqual(0);
  });
});

describe('detailLines', () => {
  it('leaves out what was not filled in', () => {
    // Voluntary fields. A label with nothing after it is worse than no row.
    expect(detailLines({ name: 'Milan Seman', reason: '   ', location: '' })).toEqual([
      'Signed by: Milan Seman',
    ]);
  });

  it('shows them in a fixed order, with the date last', () => {
    expect(
      detailLines({
        name: 'Jiří Novák',
        reason: 'Souhlasím',
        location: 'Praha',
        date: new Date(Date.UTC(2026, 8, 15)),
      }),
    ).toEqual(['Signed by: Jiří Novák', 'Souhlasím', 'Praha', '2026-09-15']);
  });

  it('gives back nothing at all when nothing was filled in', () => {
    expect(detailLines({})).toEqual([]);
  });
});

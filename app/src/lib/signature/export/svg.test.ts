import { describe, expect, it } from 'vitest';

import type { PathCommand } from '../path';
import { boundsHeight, pathBounds } from './bounds';
import { parsePathData } from './parse-path-data.test-helper';
import { toSvg } from './svg';

const arc: PathCommand[] = [
  { type: 'M', x: 0, y: 0 },
  { type: 'Q', x1: 50, y1: -100, x: 100, y: 0 },
  { type: 'Z' },
];

describe('toSvg', () => {
  it('is null when there is no ink', () => {
    expect(toSvg([], { padding: 0.1, color: '#000' })).toBeNull();
  });

  it('contains no text element and no font reference', () => {
    // The reason this module exists. An SVG that names a font is a signature
    // only on machines that have that font.
    const svg = toSvg(arc, { padding: 0.1, color: '#10201a' })!;
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('font');
    expect(svg).not.toContain('@font-face');
  });

  it('sizes the viewBox to the trimmed ink plus padding', () => {
    // The arc peaks at -50, so the ink is 100 wide and 50 tall.
    const svg = toSvg(arc, { padding: 0, color: '#000' })!;
    expect(svg).toContain('viewBox="0 0 100 50"');
    expect(svg).toContain('width="100"');
    expect(svg).toContain('height="50"');
  });

  it('places the ink inside the box, flush against the padding', () => {
    // Trimming means the drawing starts at the margin and ends at the far
    // margin, with nothing spilling outside the viewBox.
    //
    // Measured on the curve, not on the raw numbers in the `d`: a control
    // point is allowed to sit outside the box, because the curve it steers
    // does not go there. Asserting on the digits in the string would fail for
    // a correct file.
    const padding = 0.1;
    const svg = toSvg(arc, { padding, color: '#000' })!;
    const d = /d="([^"]+)"/.exec(svg)![1];

    const placed = pathBounds(parsePathData(d))!;
    const viewBox = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)!;
    const width = Number(viewBox[1]);
    const height = Number(viewBox[2]);
    const margin = boundsHeight(placed) * padding;

    expect(placed.minX).toBeCloseTo(margin, 6);
    expect(placed.minY).toBeCloseTo(margin, 6);
    expect(placed.maxX).toBeCloseTo(width - margin, 6);
    expect(placed.maxY).toBeCloseTo(height - margin, 6);
  });

  it('scales the declared size but not the viewBox', () => {
    // A scaled SVG is the same drawing at a different natural size, which is
    // what lets it be compared against a PNG exported at the same scale.
    const svg = toSvg(arc, { padding: 0, color: '#000', scale: 4 })!;
    expect(svg).toContain('viewBox="0 0 100 50"');
    expect(svg).toContain('width="400"');
    expect(svg).toContain('height="200"');
  });

  it('writes the colour as given', () => {
    expect(toSvg(arc, { padding: 0, color: '#baff73' })!).toContain('fill="#baff73"');
  });

  it('escapes a colour rather than letting it close the attribute', () => {
    const svg = toSvg(arc, { padding: 0, color: '"><script>x</script>' })!;
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('is well-formed XML', () => {
    const svg = toSvg(arc, { padding: 0.08, color: '#10201a' })!;
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*>.*<\/svg>\n$/s);
    expect(svg).not.toContain('NaN');
    expect(svg).not.toContain('undefined');
  });
});

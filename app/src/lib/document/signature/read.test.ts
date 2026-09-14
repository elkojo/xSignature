// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { toSvg } from '../../signature/export/svg';
import type { PathCommand } from '../../signature/path';
import {
  looksLikeJpeg,
  looksLikePng,
  readSignatureImage,
  readSignatureSvg,
  UnreadableSignature,
} from './read';

/** A shape with a curve and a corner, so the round trip has something to lose. */
const INK: PathCommand[] = [
  { type: 'M', x: 10, y: 40 },
  { type: 'L', x: 60, y: 40 },
  { type: 'Q', x1: 85, y1: 15, x: 110, y: 40 },
  { type: 'C', x1: 120, y1: 55, x2: 130, y2: 20, x: 140, y: 40 },
  { type: 'Z' },
];

describe('readSignatureSvg', () => {
  it('reads back exactly what this app wrote', () => {
    // The round trip that matters: an SVG copied from the signature screen and
    // pasted onto a document must be the same outlines, not an approximation.
    const markup = toSvg(INK, { padding: 0.08, color: '#1f3a68' })!;
    const read = readSignatureSvg(markup);

    expect(read.kind).toBe('vector');
    expect(read.color).toBe('#1f3a68');
    expect(read.commands).toHaveLength(INK.length);
    expect(read.commands.map((c) => c.type)).toEqual(['M', 'L', 'Q', 'C', 'Z']);
  });

  it('keeps the proportions the file declares', () => {
    // Checked against the file rather than against arithmetic done here: the
    // viewBox is the statement of record, and reading it back must agree with
    // it exactly.
    const markup = toSvg(INK, { padding: 0.08, color: '#000000' })!;
    const declared = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(markup)!;
    const read = readSignatureSvg(markup);

    expect(read.width).toBeCloseTo(Number(declared[1]), 6);
    expect(read.height).toBeCloseTo(Number(declared[2]), 6);
  });

  it('survives being exported at a scale, since the viewBox is what counts', () => {
    const big = toSvg(INK, { padding: 0.08, color: '#000000', scale: 4 })!;
    const small = toSvg(INK, { padding: 0.08, color: '#000000' })!;

    expect(readSignatureSvg(big).width).toBeCloseTo(readSignatureSvg(small).width, 6);
  });

  it('refuses an SVG that draws with text, which needs a font to be right', () => {
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5"><text x="0" y="4">Ada</text></svg>';
    expect(() => readSignatureSvg(markup)).toThrow(/text or an embedded image/);
  });

  it('refuses an SVG built from shapes rather than paths', () => {
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5"><circle cx="5" cy="2" r="2"/></svg>';
    expect(() => readSignatureSvg(markup)).toThrow(/shapes rather than paths/);
  });

  it('refuses transforms rather than placing the ink somewhere else', () => {
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5">' +
      '<g transform="translate(3 3)"><path d="M0 0L1 1"/></g></svg>';
    expect(() => readSignatureSvg(markup)).toThrow(/transforms/);
  });

  it('refuses relative path commands rather than misreading them as absolute', () => {
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5"><path d="m0 0l1 1"/></svg>';
    expect(() => readSignatureSvg(markup)).toThrow(/relative or curved commands/);
  });

  it('refuses an empty drawing and something that is not an SVG at all', () => {
    const empty = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5"></svg>';
    expect(() => readSignatureSvg(empty)).toThrow(UnreadableSignature);
    expect(() => readSignatureSvg('just some words')).toThrow(/does not look like an SVG/);
  });

  it('refuses an SVG that does not say how big it is', () => {
    const markup = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>';
    expect(() => readSignatureSvg(markup)).toThrow(/how big it is/);
  });

  it('falls back to width and height when there is no viewBox', () => {
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="12"><path d="M0 0L1 1"/></svg>';
    expect(readSignatureSvg(markup)).toMatchObject({ width: 40, height: 12 });
  });
});

/** A PNG header with the size and colour type written in by hand. */
function png(width: number, height: number, colourType: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(40));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8;
  bytes[25] = colourType;
  return bytes;
}

describe('readSignatureImage', () => {
  it('reads a PNG size out of its header', () => {
    expect(readSignatureImage(png(2280, 388, 6), 'image/png')).toMatchObject({
      kind: 'raster',
      width: 2280,
      height: 388,
    });
  });

  it('knows which PNGs carry transparency', () => {
    // Colour type 6 is truecolour with alpha; 2 is truecolour without.
    expect(readSignatureImage(png(10, 10, 6), 'image/png').hasAlpha).toBe(true);
    expect(readSignatureImage(png(10, 10, 4), 'image/png').hasAlpha).toBe(true);
    expect(readSignatureImage(png(10, 10, 2), 'image/png').hasAlpha).toBe(false);
  });

  it('marks a JPEG as having no transparency, because it cannot', () => {
    // It matters: a JPEG signature paints a solid rectangle over the document.
    const raw = [
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0),
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x02, 0x58,
    ];
    const jpeg = new Uint8Array(new ArrayBuffer(raw.length));
    jpeg.set(raw);
    const read = readSignatureImage(jpeg, 'image/jpeg');
    expect(read.hasAlpha).toBe(false);
    expect(read.width).toBe(600);
    expect(read.height).toBe(300);
  });

  it('refuses a format it cannot place', () => {
    expect(() => readSignatureImage(new Uint8Array(new ArrayBuffer(10)), 'image/gif')).toThrow(
      UnreadableSignature,
    );
  });
});

describe('the magic-byte checks', () => {
  it('recognises each format by its header, not its name', () => {
    expect(looksLikePng(png(1, 1, 6))).toBe(true);
    expect(looksLikeJpeg(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(looksLikePng(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe(false);
    expect(looksLikeJpeg(png(1, 1, 6))).toBe(false);
  });
});

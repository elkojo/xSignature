import { PDFDocument } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import type { PathCommand } from '../../signature/path';
import { openPdf } from '../pdf/inspect';
import type { PageGeometry } from '../place/placement';
import { applyStamp, hexToRgb, stampOperators, type Stamp } from './stamp';

const A4: PageGeometry = { x: 0, y: 0, width: 595, height: 842, rotation: 0 };

const INK: PathCommand[] = [
  { type: 'M', x: 0, y: 0 },
  { type: 'L', x: 100, y: 0 },
  { type: 'Q', x1: 120, y1: 25, x: 100, y: 50 },
  { type: 'Z' },
];

const stamp = (over: Partial<Stamp> = {}): Stamp => ({
  page: 0,
  rect: { x: 0.1, y: 0.8, width: 0.4, height: 0.1 },
  commands: INK,
  width: 100,
  height: 50,
  color: '#1b3f8b',
  ...over,
});

/** What the stamp draws, as the content stream would read. */
const drawn = (geometry: PageGeometry, s: Stamp): string =>
  stampOperators(geometry, s)
    .map((op) => op.toString())
    .join('\n');

describe('hexToRgb', () => {
  it('splits a six-digit hex into 0-1 components', () => {
    expect(hexToRgb('#ffffff')).toEqual({ r: 1, g: 1, b: 1 });
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('gives black for a colour it cannot read, rather than NaN', () => {
    // An SVG from elsewhere may say `fill="none"` and put the colour on the
    // stroke, or name a colour outright. The writer rejects a component that is
    // not a number, so an unreadable colour used to surface several layers away
    // as "this document could not be written" — which is wrong and unactionable.
    for (const value of ['none', 'black', 'rgb(0,0,0)', '', '#12', '#gggggg']) {
      expect(hexToRgb(value)).toEqual({ r: 0, g: 0, b: 0 });
    }
  });

  it('tolerates surrounding space', () => {
    expect(hexToRgb('  #ffffff  ')).toEqual({ r: 1, g: 1, b: 1 });
  });

  it('reads a three-digit hex the way CSS does', () => {
    expect(hexToRgb('#f00')).toEqual(hexToRgb('#ff0000'));
  });

  it('works without the hash', () => {
    expect(hexToRgb('1b3f8b')).toEqual(hexToRgb('#1b3f8b'));
  });
});

describe('applyStamp', () => {
  it('brackets its drawing in a saved and restored graphics state', () => {
    // Without this the matrix and the ink colour leak into anything the page
    // draws after the stamp.
    const lines = drawn(A4, stamp()).split('\n');
    expect(lines[0]).toBe('q');
    expect(lines[lines.length - 1]).toBe('Q');
  });

  it('writes one concatenated matrix and the ink colour, before any drawing', () => {
    const lines = drawn(A4, stamp({ color: '#000000' })).split('\n');
    expect(lines[1]).toMatch(/^[\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ cm$/);
    expect(lines[2]).toBe('0 0 0 rg');
    expect(lines[3]).toMatch(/ m$/);
  });

  it('sets the ink from the chosen colour', () => {
    expect(drawn(A4, stamp({ color: '#ffffff' }))).toContain('1 1 1 rg');
  });

  it('draws nothing at all when there is no ink, not even an empty state pair', async () => {
    expect(stampOperators(A4, stamp({ commands: [] }))).toEqual([]);

    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    applyStamp(doc, A4, stamp({ commands: [] }));
    expect(doc.getPage(0).node.Contents()).toBeUndefined();
  });

  it('produces a document that opens again cleanly', async () => {
    // The real check: a stamped file has to survive being parsed by something
    // that did not write it.
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    doc.addPage([595, 842]);
    applyStamp(doc, A4, stamp({ page: 1 }));

    const reopened = await openPdf(await doc.save());
    expect(reopened.pages).toHaveLength(2);
  });

  it('puts the ink on the page it was told to, and nowhere else', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    doc.addPage([595, 842]);
    applyStamp(doc, A4, stamp({ page: 1 }));

    const first = doc.getPage(0).node.Contents();
    const second = doc.getPage(1).node.Contents();
    expect(first).toBeUndefined();
    expect(second).toBeDefined();
  });

  it('scales the same signature down when the box is smaller', () => {
    const scaleFor = (width: number) => {
      const line = drawn(A4, stamp({ rect: { x: 0.1, y: 0.8, width, height: 0.1 } })).split('\n')[1];
      return Number(line.split(' ')[0]);
    };
    expect(scaleFor(0.4)).toBeGreaterThan(scaleFor(0.2));
  });
});

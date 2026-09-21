import { PDFDocument, PDFHexString, PDFName, PDFObject, PDFString } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { occupants, occupantsOn, overlapping, overlaps, type Rect } from './annotations';

/**
 * One annotation, in the shape `context.obj` takes.
 *
 * Spelled out because `obj` is overloaded on dictionaries and arrays, and
 * `Parameters<>` picks whichever overload is last rather than the one meant.
 */
type Value = Literal | Value[] | PDFObject | string | number | boolean | null | undefined;
interface Literal {
  [key: string]: Value;
}

async function pageWith(annotations: Literal[]): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.node.set(
    PDFName.of('Annots'),
    doc.context.obj(annotations.map((entry) => doc.context.register(doc.context.obj(entry)))),
  );
  return doc;
}

describe('overlaps', () => {
  const box: Rect = [100, 100, 200, 200];

  it('sees a rectangle that lands on another', () => {
    expect(overlaps(box, [150, 150, 250, 250])).toBe(true);
    expect(overlaps(box, [110, 110, 120, 120])).toBe(true);
    expect(overlaps(box, [0, 0, 999, 999])).toBe(true);
  });

  it('leaves rectangles that only share an edge alone', () => {
    // Signatures in adjacent table cells are the ordinary case, and DSS's own
    // test is strict for exactly this reason. Reporting them would train the
    // reader to ignore the warning.
    expect(overlaps(box, [200, 100, 300, 200])).toBe(false);
    expect(overlaps(box, [100, 200, 200, 300])).toBe(false);
    expect(overlaps(box, [0, 0, 100, 100])).toBe(false);
  });

  it('leaves rectangles well clear alone', () => {
    expect(overlaps(box, [300, 300, 400, 400])).toBe(false);
    // Overlapping on one axis only is not an overlap.
    expect(overlaps(box, [150, 300, 250, 400])).toBe(false);
  });

  it('says a rectangle with no area overlaps nothing', () => {
    // How an invisible signature is written. Two of them on one page are not a
    // finding in any validator, and must not be one here.
    expect(overlaps([0, 0, 0, 0], [0, 0, 0, 0])).toBe(false);
    expect(overlaps([0, 0, 0, 0], box)).toBe(false);
    expect(overlaps(box, [150, 150, 150, 190])).toBe(false);
  });

  it('does not care which corner was written first', () => {
    expect(overlaps(box, [250, 250, 150, 150])).toBe(true);
    expect(overlaps([200, 200, 100, 100], [150, 150, 250, 250])).toBe(true);
  });
});

describe('occupantsOn', () => {
  it('finds nothing on a page with no annotations', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    expect(occupantsOn(doc, 0)).toEqual([]);
  });

  it('names a signed signature field by its signer', async () => {
    const doc = await pageWith([
      {
        Type: 'Annot',
        Subtype: 'Widget',
        FT: 'Sig',
        Rect: [100, 100, 300, 160],
        T: PDFString.of('Signature'),
        V: { Type: 'Sig', Name: PDFString.of('Jan Purkrábek') },
      },
    ]);

    expect(occupantsOn(doc, 0)).toEqual([
      { page: 0, rect: [100, 100, 300, 160], kind: 'signature', label: 'Jan Purkrábek' },
    ]);
  });

  it('falls back to the field name when the signer did not give one', async () => {
    const doc = await pageWith([
      {
        Type: 'Annot',
        Subtype: 'Widget',
        FT: 'Sig',
        Rect: [100, 100, 300, 160],
        T: PDFString.of('Signature 2'),
        V: { Type: 'Sig' },
      },
    ]);

    const [found] = occupantsOn(doc, 0);
    expect(found.kind).toBe('signature');
    expect(found.label).toBe('Signature 2');
  });

  it('reads a signer written as a hex string', async () => {
    // What `signature-dict` writes for a name Latin-1 cannot spell: UTF-16BE
    // behind a byte-order mark. Reading it as a literal would show mojibake in
    // the one place a Czech signer would notice immediately.
    const doc = await pageWith([
      {
        Type: 'Annot',
        Subtype: 'Widget',
        FT: 'Sig',
        Rect: [100, 100, 300, 160],
        V: { Type: 'Sig', Name: PDFHexString.fromText('Jiří Novák') },
      },
    ]);

    expect(occupantsOn(doc, 0)[0].label).toBe('Jiří Novák');
  });

  it('tells a signature field waiting to be signed from one already signed', async () => {
    const doc = await pageWith([
      {
        Type: 'Annot',
        Subtype: 'Widget',
        FT: 'Sig',
        Rect: [100, 100, 300, 160],
        T: PDFString.of('Counterparty'),
      },
    ]);

    const [found] = occupantsOn(doc, 0);
    expect(found.kind).toBe('empty-signature');
    expect(found.label).toBe('Counterparty');
  });

  it('reports other form fields and plain annotations too', async () => {
    // DSS's check is over every annotation, not only signatures, so a link in
    // the footer counts and this has to see it.
    const doc = await pageWith([
      {
        Type: 'Annot',
        Subtype: 'Widget',
        FT: 'Tx',
        Rect: [50, 50, 200, 70],
        T: PDFString.of('Full name'),
      },
      { Type: 'Annot', Subtype: 'Link', Rect: [50, 20, 200, 35] },
    ]);

    expect(occupantsOn(doc, 0).map((found) => [found.kind, found.label])).toEqual([
      ['field', 'Full name'],
      ['annotation', 'Link'],
    ]);
  });

  it('leaves out what is in nobody\'s way', async () => {
    // An invisible signature's zero-sized rectangle, an annotation with no
    // rectangle at all, and one whose rectangle is not numbers.
    const doc = await pageWith([
      { Type: 'Annot', Subtype: 'Widget', FT: 'Sig', Rect: [0, 0, 0, 0] },
      { Type: 'Annot', Subtype: 'Link' },
      { Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 'x', 10] },
      { Type: 'Annot', Subtype: 'Link', Rect: [10, 20, 30] },
    ]);

    expect(occupantsOn(doc, 0)).toEqual([]);
  });

  it('writes the rectangle lower-left first however it was stored', async () => {
    const doc = await pageWith([
      { Type: 'Annot', Subtype: 'Link', Rect: [300, 160, 100, 100] },
    ]);

    expect(occupantsOn(doc, 0)[0].rect).toEqual([100, 100, 300, 160]);
  });
});

describe('occupants', () => {
  it('walks every page and says which is which', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const second = doc.addPage([595, 842]);
    second.node.set(
      PDFName.of('Annots'),
      doc.context.obj([
        doc.context.register(
          doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 40, 40] }),
        ),
      ]),
    );

    expect(occupants(doc).map((found) => found.page)).toEqual([1]);
  });
});

describe('overlapping', () => {
  it('returns only what the new rectangle would land on', async () => {
    const doc = await pageWith([
      {
        Type: 'Annot',
        Subtype: 'Widget',
        FT: 'Sig',
        Rect: [100, 100, 300, 160],
        V: { Type: 'Sig', Name: PDFString.of('Jan Purkrábek') },
      },
      { Type: 'Annot', Subtype: 'Link', Rect: [400, 400, 500, 450] },
    ]);
    const existing = occupantsOn(doc, 0);

    expect(overlapping([280, 140, 420, 200], existing).map((found) => found.label)).toEqual([
      'Jan Purkrábek',
    ]);
    expect(overlapping([300, 100, 500, 160], existing)).toEqual([]);
  });
});

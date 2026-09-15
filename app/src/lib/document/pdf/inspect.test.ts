import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { hasSignatureField, openPdf, pageGeometries, UnreadablePdf } from './inspect';

async function blank(pages: Array<[number, number]> = [[595, 842]]): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  for (const [w, h] of pages) doc.addPage([w, h]);
  return doc;
}

/** Give a document an AcroForm with the field tree described by `fields`. */
function withForm(doc: PDFDocument, fields: unknown[]): void {
  const refs = fields.map((f) => doc.context.register(doc.context.obj(f as never)));
  const acro = doc.context.obj({ Fields: refs });
  doc.catalog.set(PDFName.of('AcroForm'), doc.context.register(acro));
}

const bytes = (doc: PDFDocument) => doc.save();

describe('pageGeometries', () => {
  it('reports each page in order', async () => {
    const doc = await blank([
      [595, 842],
      [420, 595],
    ]);
    const geo = pageGeometries(doc);
    expect(geo).toHaveLength(2);
    expect(geo[0]).toMatchObject({ width: 595, height: 842, rotation: 0 });
    expect(geo[1]).toMatchObject({ width: 420, height: 595 });
  });

  it('carries the rotation through, normalized', async () => {
    const doc = await blank();
    doc.getPage(0).setRotation({ type: 'degrees', angle: -90 } as never);
    expect(pageGeometries(doc)[0].rotation).toBe(270);
  });

  it('reports the crop box origin rather than assuming (0, 0)', async () => {
    const doc = await blank();
    doc.getPage(0).setCropBox(30, 40, 500, 700);
    expect(pageGeometries(doc)[0]).toMatchObject({ x: 30, y: 40, width: 500, height: 700 });
  });
});

describe('hasSignatureField', () => {
  it('is false for a document with no form at all', async () => {
    expect(hasSignatureField(await blank())).toBe(false);
  });

  it('is false for a form with only ordinary fields', async () => {
    const doc = await blank();
    withForm(doc, [{ FT: 'Tx', T: 'name' }, { FT: 'Btn', T: 'agree' }]);
    expect(hasSignatureField(doc)).toBe(false);
  });

  it('finds a signature field at the top level', async () => {
    const doc = await blank();
    withForm(doc, [{ FT: 'Tx', T: 'name' }, { FT: 'Sig', T: 'Signature1' }]);
    expect(hasSignatureField(doc)).toBe(true);
  });

  it('finds one nested under Kids', async () => {
    const doc = await blank();
    const kid = doc.context.register(doc.context.obj({ FT: 'Sig', T: 'inner' }));
    withForm(doc, [{ T: 'group', Kids: [kid] }]);
    expect(hasSignatureField(doc)).toBe(true);
  });

  it('finds one whose type is inherited from its parent', async () => {
    // FT is an inheritable key: the child need not repeat it.
    const doc = await blank();
    const kid = doc.context.register(doc.context.obj({ T: 'inner' }));
    withForm(doc, [{ FT: 'Sig', T: 'group', Kids: [kid] }]);
    expect(hasSignatureField(doc)).toBe(true);
  });

  it('does not hang on a Kids cycle', async () => {
    // Malformed files do contain these, and a loop here would lock the page
    // rather than report anything.
    const doc = await blank();
    const parentRef = doc.context.nextRef();
    const parent = doc.context.obj({ T: 'loop', Kids: [parentRef] });
    doc.context.assign(parentRef, parent);
    const acro = doc.context.obj({ Fields: [parentRef] });
    doc.catalog.set(PDFName.of('AcroForm'), doc.context.register(acro));

    expect(hasSignatureField(doc)).toBe(false);
  });
});

describe('openPdf', () => {
  it('opens an ordinary document and describes its pages', async () => {
    const open = await openPdf(await bytes(await blank([[595, 842]])));
    expect(open.pages).toHaveLength(1);
    expect(open.pages[0]).toMatchObject({ width: 595, height: 842, rotation: 0 });
  });

  it('opens a document that is already signed, and says what it carries', async () => {
    // It used to refuse. Rewriting a signed PDF really does destroy what is
    // there — but appending to one does not, and that is what counter-signing
    // is. So the danger is reported and the caller decides, rather than every
    // signed document being turned away.
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const { applyCertificateSignature } = await import('../certificate/sign/apply');
    const { makeKeyFiles } = await import('../certificate/read/fixtures/make-keys');
    const { readKeyFile } = await import('../certificate/read/read');

    const keys = await makeKeyFiles({ commonName: 'First Signer' });
    const [identity] = await readKeyFile('k.p12', keys.modern, keys.password);
    const base = await PDFDocument.create();
    base.addPage([595, 842]);
    const signed = await applyCertificateSignature(await base.save(), identity);

    const open = await openPdf(signed.bytes);
    expect(open.existing).toHaveLength(1);
    expect(open.existing[0].type).toBe('Sig');
    expect(open.pages).toHaveLength(1);
  }, 60_000);

  it('reports an ordinary document as carrying nothing', async () => {
    const open = await openPdf(await bytes(await blank()));
    expect(open.existing).toEqual([]);
  });

  it('reports damaged input as malformed', async () => {
    const junk = new TextEncoder().encode('%PDF-1.7\nthis is not a pdf at all');
    const failure = await openPdf(junk).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(UnreadablePdf);
    expect((failure as UnreadablePdf).kind).toBe('malformed');
  });
});

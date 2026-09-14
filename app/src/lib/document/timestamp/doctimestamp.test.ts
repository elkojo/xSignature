import { PDFArray, PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { findContentsSpan } from './byte-range';
import { addDocTimeStampPlaceholder } from './doctimestamp';

async function blank(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return doc.save();
}

/** Add the placeholder to `base` and write the result out. */
async function stamped(base: Uint8Array): Promise<{ bytes: Uint8Array; text: string }> {
  const doc = await PDFDocument.load(base, { updateMetadata: false, forIncrementalUpdate: true });
  addDocTimeStampPlaceholder(doc);
  const bytes = await doc.commit({ useObjectStreams: false });
  return { bytes, text: new TextDecoder('latin1').decode(bytes) };
}

describe('addDocTimeStampPlaceholder', () => {
  it('writes a document timestamp, not a signature', async () => {
    // The distinction is the point of the whole feature: /DocTimeStamp says
    // these bytes existed at a time, and claims nothing about who made them.
    const { text } = await stamped(await blank());

    expect(text).toContain('/Type /DocTimeStamp');
    expect(text).toContain('/SubFilter /ETSI.RFC3161');
    expect(text).not.toContain('ETSI.CAdES.detached');
    expect(text).not.toContain('adbe.pkcs7');
  });

  it('leaves the original bytes exactly as they were', async () => {
    // An incremental update, not a rewrite. The timestamp has to be able to
    // describe the document as it arrived.
    const base = await blank();
    const { bytes } = await stamped(base);

    expect(bytes.length).toBeGreaterThan(base.length);
    expect(Array.from(bytes.subarray(0, base.length))).toEqual(Array.from(base));
  });

  it('reserves a hole the byte range can name', async () => {
    const { bytes, text } = await stamped(await blank());
    const span = findContentsSpan(bytes);

    expect(text).toContain('/ByteRange [ 0 9999999999 9999999999 9999999999 ]');
    expect(span.end - span.start).toBeGreaterThan(20_000);
  });

  it('keeps the signature dictionary out of a compressed object stream', async () => {
    // A reader has to find /Contents in the file's plain bytes to skip over it.
    const { text } = await stamped(await blank());
    expect(text).toContain('/Contents <0000');
  });

  it('marks the form append-only, so a viewer warns instead of destroying it', async () => {
    const { bytes } = await stamped(await blank());
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const acroForm = doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict);

    // 3 is SignaturesExist | AppendOnly.
    expect(acroForm.get(PDFName.of('SigFlags'))?.toString()).toBe('3');
  });

  it('attaches an invisible widget to the page', async () => {
    const { bytes } = await stamped(await blank());
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);

    expect(annots.size()).toBe(1);
    const widget = annots.lookup(0, PDFDict);
    expect(widget.get(PDFName.of('FT'))?.toString()).toBe('/Sig');
    expect(widget.lookup(PDFName.of('Rect'), PDFArray).toString()).toBe('[ 0 0 0 0 ]');
  });

  it('gives a second timestamp its own field name rather than replacing the first', async () => {
    // Two fields sharing a name are one field to a reader, which would make the
    // second timestamp look like it had overwritten the first.
    const first = (await stamped(await blank())).bytes;
    const { text } = await stamped(first);

    expect(text).toContain('(Timestamp)');
    expect(text).toContain('(Timestamp 2)');
  });
});

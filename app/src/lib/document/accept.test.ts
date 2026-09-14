import { describe, expect, it } from 'vitest';

import { accept, HEAD_BYTES, looksLikePdf } from './accept';

const PDF_HEAD = new TextEncoder().encode('%PDF-1.7');
const ZIP_HEAD = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
const NOTHING = new Uint8Array(HEAD_BYTES);

describe('looksLikePdf', () => {
  it('recognises the header', () => {
    expect(looksLikePdf(PDF_HEAD)).toBe(true);
  });

  it('is not fooled by a zip, which is what a .docx really is', () => {
    expect(looksLikePdf(ZIP_HEAD)).toBe(false);
  });

  it('says no rather than throwing when there are not enough bytes to tell', () => {
    expect(looksLikePdf(new Uint8Array([0x25, 0x50]))).toBe(false);
  });
});

describe('accept', () => {
  it('sends a PDF straight to the stamper', () => {
    expect(accept('contract.pdf', PDF_HEAD)).toEqual({ route: 'stamp', format: 'PDF' });
  });

  it('trusts the bytes over the extension, so a mislabelled PDF is still stamped directly', () => {
    // Worth being deliberate about: routing this through the converter would
    // both cost the reader a large download and re-typeset a document that was
    // already laid out.
    expect(accept('contract.txt', PDF_HEAD).route).toBe('stamp');
  });

  it('lays plain text out here, with nothing to download', () => {
    // A .txt has no structure to lose, so sending it through a document
    // converter would cost a large download and gain nothing.
    expect(accept('notes.txt', NOTHING)).toEqual({ route: 'text', format: 'Plain text' });
    expect(accept('server.LOG', NOTHING).route).toBe('text');
  });

  it('routes documents with structure in them to the converter, naming the format', () => {
    expect(accept('lease.docx', ZIP_HEAD)).toEqual({ route: 'convert', format: 'Word document' });
    expect(accept('notes.odt', ZIP_HEAD).format).toBe('OpenDocument text');
    expect(accept('README.md', NOTHING).format).toBe('Markdown');
    expect(accept('terms.RTF', NOTHING).route).toBe('convert');
  });

  it('explains the refusal for things that look like documents but are not', () => {
    const old = accept('memo.doc', NOTHING);
    expect(old.route).toBe('reject');
    expect(old.reason).toMatch(/\.docx or PDF/);

    expect(accept('budget.xlsx', ZIP_HEAD).reason).toMatch(/not documents to sign/);
  });

  it('refuses anything else without pretending to know what it was', () => {
    const image = accept('scan.png', NOTHING);
    expect(image.route).toBe('reject');
    expect(image.format).toBe('.png');

    expect(accept('LICENSE', NOTHING).format).toBe('file');
  });
});

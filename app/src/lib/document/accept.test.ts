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
    // Re-typesetting a document that was already laid out would lose its
    // layout for no reason.
    expect(accept('contract.txt', PDF_HEAD).route).toBe('stamp');
  });

  it('lays plain text out here, with nothing to download', () => {
    expect(accept('notes.txt', NOTHING)).toEqual({ route: 'text', format: 'Plain text' });
    expect(accept('server.LOG', NOTHING).route).toBe('text');
  });

  it('sets Markdown here too, since its structure fits the built-in fonts', () => {
    expect(accept('README.md', NOTHING)).toEqual({ route: 'text', format: 'Markdown' });
    expect(accept('notes.markdown', NOTHING).route).toBe('text');
  });

  it('turns word processor formats away, and says what to do instead', () => {
    // The important refusals: somebody dropping a .docx has every reason to
    // expect it to work, and a bare "unsupported file" tells them nothing.
    for (const name of ['lease.docx', 'memo.doc', 'notes.odt', 'terms.RTF']) {
      const verdict = accept(name, ZIP_HEAD);
      expect(verdict.route).toBe('reject');
      expect(verdict.reason).toMatch(/PDF/);
    }

    expect(accept('lease.docx', ZIP_HEAD).reason).toMatch(/Save As or Print to PDF/);
    expect(accept('notes.odt', ZIP_HEAD).reason).toMatch(/LibreOffice/);
  });

  it('has no route that promises a conversion it cannot do', () => {
    // There is no converter and there is not going to be one. A route that
    // said otherwise would be a promise the app cannot keep.
    const routes = ['lease.docx', 'a.odt', 'b.epub', 'c.html', 'd.tex', 'e.rst']
      .map((name) => accept(name, ZIP_HEAD).route);
    expect(new Set(routes)).toEqual(new Set(['reject']));
  });

  it('explains the refusal for things that are documents but not ones to sign', () => {
    expect(accept('budget.xlsx', ZIP_HEAD).reason).toMatch(/not documents to sign/);
    expect(accept('deck.pptx', ZIP_HEAD).reason).toMatch(/not documents to sign/);
  });

  it('refuses anything else without pretending to know what it was', () => {
    const image = accept('scan.png', NOTHING);
    expect(image.route).toBe('reject');
    expect(image.format).toBe('.png');
    expect(image.reason).toMatch(/PDFs, plain text and Markdown/);

    expect(accept('LICENSE', NOTHING).format).toBe('file');
  });
});

import { PDFDocument } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { openPdf } from '../pdf/inspect';
import { textToPdf, toWinAnsi } from './text-to-pdf';

describe('toWinAnsi', () => {
  it('leaves ordinary text alone', () => {
    expect(toWinAnsi('Plain ASCII, and accents: café naïve')).toBe(
      'Plain ASCII, and accents: café naïve',
    );
  });

  it('reads typographic punctuation across rather than dropping it', () => {
    // These arrive in nearly every file written in a word processor.
    expect(toWinAnsi('“quoted” — it’s fine…')).toBe('"quoted" -- it\'s fine...');
  });

  it('substitutes what the built-in fonts cannot carry instead of failing', () => {
    expect(toWinAnsi('日本語')).toBe('???');
  });
});

describe('textToPdf', () => {
  it('produces a PDF the rest of the app can open', async () => {
    const pdf = await textToPdf('Hello.\nThis is a plain text file.');
    const opened = await openPdf(pdf);

    expect(opened.pages).toHaveLength(1);
    expect(opened.pages[0].width).toBeCloseTo(595.28, 1);
  });

  it('runs long text onto more pages', async () => {
    const long = Array.from({ length: 200 }, (_, i) => `Line number ${i}.`).join('\n');
    const opened = await openPdf(await textToPdf(long));

    expect(opened.pages.length).toBeGreaterThan(1);
  });

  it('records where the document came from', async () => {
    const doc = await PDFDocument.load(await textToPdf('x', { title: 'notes.txt' }), {
      updateMetadata: false,
    });
    expect(doc.getTitle()).toBe('notes.txt');
  });

  it('survives characters the built-in fonts cannot encode', async () => {
    // Before the substitution this threw, and a file with one em-dash in it
    // could not be converted at all.
    await expect(textToPdf('An em-dash — and a bullet • and 日本語')).resolves.toBeTruthy();
  });

  it('does not fall over on an empty file', async () => {
    const opened = await openPdf(await textToPdf(''));
    expect(opened.pages).toHaveLength(1);
  });

  it('keeps the text as text, not as a picture of text', async () => {
    const pdf = await textToPdf('Findable words here.');
    // The built-in fonts leave the string legible in the content stream.
    const doc = await PDFDocument.load(pdf, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(1);
    expect(pdf.length).toBeLessThan(20_000); // a raster page would be far larger
  });
});

import { PDFDocument } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { openPdf } from '../pdf/inspect';
import { readBackText } from './read-back';
import { textToPdf } from './text-to-pdf';

describe('the text a converted document actually carries', () => {
  it('says what the file said, in a language WinAnsi cannot spell', async () => {
    // The reason these documents no longer use PDF's built-in fonts. Those are
    // one byte a character, and wrote "Uzav?ená" into the body of a contract —
    // silently, with no error and nothing to notice. Read back with a library
    // that did not write it, because a font embedded without its character map
    // draws perfectly and reads as nothing at all.
    const czech = 'Uzavřená smlouva o dílo, příloha č. 1.\nZdeňka Růžičková';
    const text = await readBackText(await textToPdf(czech));

    expect(text).toContain('Uzavřená smlouva o dílo');
    expect(text).toContain('příloha č. 1');
    expect(text).toContain('Zdeňka Růžičková');
    expect(text).not.toContain('?');
  });

  it('carries the punctuation a word processor produces', async () => {
    const text = await readBackText(await textToPdf('“quoted” — it’s fine…'));

    expect(text).toContain('“quoted”');
    expect(text).toContain('—');
    expect(text).toContain('…');
  });

  it('keeps plain ASCII exactly as it was', async () => {
    const text = await readBackText(await textToPdf('Plain ASCII, and accents: café naïve'));
    expect(text).toContain('Plain ASCII, and accents: café naïve');
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
    // Bigger than it was: a document that can spell carries the font it is set
    // in, about 60 kB of subset monospace. Still an order of magnitude under a
    // page rasterized to an image, which is what this guards against.
    expect(pdf.length).toBeLessThan(200_000); // a raster page would be far larger
  });
});

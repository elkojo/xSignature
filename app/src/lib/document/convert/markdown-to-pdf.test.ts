import { PDFDocument } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { openPdf } from '../pdf/inspect';
import { markdownToPdf } from './markdown-to-pdf';
import { readBackText } from './read-back';

const SAMPLE = `# Agreement

Made between the parties, with **bold** and *italic*.

1. First term
2. Second term
   - a nested point

> A quotation.

| Item | Amount |
| --- | --- |
| Retainer | 1,000 |

\`\`\`
rate: 1000
\`\`\`

---

Signed:
`;

describe('markdownToPdf', () => {
  it('produces a PDF the rest of the app can open and stamp', async () => {
    const opened = await openPdf(await markdownToPdf(SAMPLE));
    expect(opened.pages).toHaveLength(1);
    expect(opened.pages[0].width).toBeCloseTo(595.28, 1);
  });

  it('keeps the words as text, not as a picture of text', async () => {
    // The whole document screen rests on this: a signed document whose text was
    // flattened to a raster is not the document anybody wrote.
    // Bigger than it was: a document that can spell carries the faces it is
    // set in, about 90 kB each. This sample asks for nearly all of them. Still
    // far under a page rasterized to an image, which is what this guards.
    const pdf = await markdownToPdf(SAMPLE);
    expect(pdf.length).toBeLessThan(400_000);
  });

  it('records where the document came from', async () => {
    const doc = await PDFDocument.load(await markdownToPdf('hi', { title: 'notes.md' }), {
      updateMetadata: false,
    });
    expect(doc.getTitle()).toBe('notes.md');
  });

  it('runs a long document onto more pages', async () => {
    const long = Array.from({ length: 160 }, (_, i) => `Paragraph number ${i}.`).join('\n\n');
    const opened = await openPdf(await markdownToPdf(long));
    expect(opened.pages.length).toBeGreaterThan(1);
  });

  it('does not fall over on an empty document', async () => {
    const opened = await openPdf(await markdownToPdf(''));
    expect(opened.pages).toHaveLength(1);
  });

  it('survives characters the built-in fonts cannot encode', async () => {
    await expect(markdownToPdf('# Título — 日本語 • done')).resolves.toBeTruthy();
  });

  it('survives a document that is only a table', async () => {
    const opened = await openPdf(await markdownToPdf('| a | b |\n| --- | --- |\n| 1 | 2 |\n'));
    expect(opened.pages).toHaveLength(1);
  });

  it('survives a very long unbroken token', async () => {
    // A URL or a hash with no spaces in it: the wrapper has to cut it rather
    // than run it off the page or loop forever.
    await expect(markdownToPdf(`Here: ${'a'.repeat(4000)}`)).resolves.toBeTruthy();
  });
});

describe('the faces a document carries', () => {
  it('embeds only the ones it actually uses', async () => {
    // Every face costs the reader about 90 kB. A memo with nothing emphasised
    // and no code in it should not carry an italic and a monospace it never
    // asked for.
    const plain = await markdownToPdf('Just a paragraph of ordinary prose.');
    const everything = await markdownToPdf(SAMPLE);

    expect(plain.length).toBeLessThan(everything.length / 1.5);
  });

  it('still sets a heading in bold, which no run asks for', async () => {
    const withHeading = await markdownToPdf('# A heading\n\nAnd a paragraph.');
    const without = await markdownToPdf('A paragraph.\n\nAnd another.');

    expect(withHeading.length).toBeGreaterThan(without.length);
  });

  it('says what the document said, in a language WinAnsi cannot spell', async () => {
    const text = await readBackText(
      await markdownToPdf('# Smlouva o dílo\n\nZávěrečná ustanovení — příloha č. 1.'),
    );

    expect(text).toContain('Smlouva o dílo');
    expect(text).toContain('Závěrečná ustanovení');
    expect(text).toContain('příloha č. 1');
    expect(text).not.toContain('?');
  });
});

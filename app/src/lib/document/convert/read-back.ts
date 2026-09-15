/**
 * Read a produced PDF back with a different library, for the tests.
 *
 * The converters' one job is a document that says what the source said. The
 * only way to check that honestly is to hand the result to something that did
 * not write it — so this uses PDF.js, which is here to draw pages on screen and
 * knows nothing about how they were made.
 *
 * It is what catches the failure that matters: a font embedded without its
 * character map draws perfectly and yields nothing at all when read, and a
 * document nobody can copy from or search is a broken document however good it
 * looks.
 */
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

/** Every page's text, in reading order, as the reader would get it. */
export async function readBackText(pdf: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: pdf.slice(), useSystemFonts: false }).promise;

  const pages: string[] = [];
  for (let number = 1; number <= doc.numPages; number += 1) {
    const page = await doc.getPage(number);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => (item as TextItem).str ?? '').join(''));
  }

  await doc.cleanup();
  return pages.join('\n');
}

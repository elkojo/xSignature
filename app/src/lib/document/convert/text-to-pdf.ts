/**
 * Turning a text file into a PDF.
 *
 * Monospaced, not proportional. Plain text is the one format where the writer
 * may well have lined something up with spaces — a table, a signature block, an
 * indented quote — and a proportional font silently destroys that while looking
 * perfectly reasonable.
 *
 * The face is bundled rather than one of PDF's built-in fourteen. Those need no
 * font file, which is why they were used here first, and they are WinAnsi: one
 * byte a character, no room for `ř` or `ě` or `ů`. Handed a Czech contract they
 * wrote `Uzav?ená` into the body of it, silently. A bundled face costs bytes;
 * the built-in one cost the document.
 *
 * `embed/type0` writes the font dictionaries by hand, so this needs no font
 * library beyond the one already here for reading glyph outlines.
 */
import { PDFDocument } from '@cantoo/pdf-lib';

import { loadFace } from '../fonts/faces';
import { drawEmbeddedText, embedType0, finishFont } from './embed/type0';
import { A4_TEXT, baselineFor, layoutText, type PageSetup } from './text';

export interface TextPdfOptions {
  readonly setup?: PageSetup;
  /** Written into the PDF's title, so the file says what it came from. */
  readonly title?: string;
}

export async function textToPdf(
  text: string,
  options: TextPdfOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const setup = options.setup ?? A4_TEXT;

  const doc = await PDFDocument.create();
  if (options.title) doc.setTitle(options.title);

  const mono = await loadFace('mono');
  const font = embedType0(doc, mono.font, mono.bytes, mono.name);
  const measure = (value: string) => font.widthOfTextAtSize(value, setup.fontSize);

  for (const lines of layoutText(text, setup, measure)) {
    const page = doc.addPage([setup.width, setup.height]);
    lines.forEach((line, index) => {
      if (line === '') return;
      drawEmbeddedText(page, font, line, {
        x: setup.margin,
        y: baselineFor(index, setup),
        size: setup.fontSize,
      });
    });
  }

  // Widths and the character map can only be written once every glyph the
  // document uses is known, which is now.
  finishFont(font);

  return doc.save();
}

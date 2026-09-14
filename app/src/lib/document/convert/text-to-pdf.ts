/**
 * Turning a text file into a PDF, with no converter to download.
 *
 * The writer is already in the bundle for stamping, and a standard PDF font
 * needs no font file at all — every reader has the fourteen built-in faces. So
 * this costs nothing beyond the code you are reading, and it is why `.txt` does
 * not send anyone to fetch a document converter.
 *
 * Courier, not a proportional face. Plain text is the one format where the
 * writer may well have lined something up with spaces — a table, a signature
 * block, an indented quote — and a proportional font silently destroys that
 * while looking perfectly reasonable.
 */
import { PDFDocument, StandardFonts, type PDFFont } from '@cantoo/pdf-lib';

import { A4_TEXT, baselineFor, layoutText, type PageSetup } from './text';

/**
 * Drop characters the built-in fonts cannot encode.
 *
 * The standard fourteen are WinAnsi, which is Latin-1 and no more. Handed a
 * character outside it the writer throws, which would turn "your file has an
 * em-dash in it" into "the conversion failed". Substituting is the lesser
 * wrong, and the common cases — curly quotes, dashes — are mapped to something
 * that reads the same rather than to a question mark.
 */
export function toWinAnsi(text: string): string {
  const swaps: Record<string, string> = {
    '‘': "'",
    '’': "'",
    '“': '"',
    '”': '"',
    '–': '-',
    '—': '--',
    '…': '...',
    ' ': ' ',
    '•': '*',
    '→': '->',
  };

  let out = '';
  for (const character of text) {
    const swap = swaps[character];
    if (swap !== undefined) {
      out += swap;
      continue;
    }
    // Everything WinAnsi can carry, plus a full stop for what it cannot.
    out += character.charCodeAt(0) <= 0xff ? character : '?';
  }
  return out;
}

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
  if (options.title) doc.setTitle(toWinAnsi(options.title));

  const font: PDFFont = await doc.embedFont(StandardFonts.Courier);
  const measure = (value: string) => font.widthOfTextAtSize(toWinAnsi(value), setup.fontSize);

  for (const lines of layoutText(text, setup, measure)) {
    const page = doc.addPage([setup.width, setup.height]);
    lines.forEach((line, index) => {
      if (line === '') return;
      page.drawText(toWinAnsi(line), {
        x: setup.margin,
        y: baselineFor(index, setup),
        size: setup.fontSize,
        font,
      });
    });
  }

  return doc.save();
}

/**
 * Markdown to PDF, with nothing to download.
 *
 * Four of the built-in fourteen fonts carry the whole thing — serif regular,
 * bold, italic and bold-italic, plus Courier for code — so this needs no font
 * file and no converter. The text stays text, which is the property the whole
 * document screen rests on.
 *
 * It is a plain setting of the document, not typesetting: no hyphenation, no
 * widow control, no floats. For a letter, a memo or a set of notes — which is
 * what people put a signature on — that is the right amount of machinery.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from '@cantoo/pdf-lib';

import { flowBlocks, type LaidLine, type MeasureRun } from './flow';
import { toBlocks, type Run, type Style } from './markdown';
import { A4_TEXT, type PageSetup } from './text';
import { toWinAnsi } from './text-to-pdf';

const FACES: Record<Style, StandardFonts> = {
  regular: StandardFonts.TimesRoman,
  bold: StandardFonts.TimesRomanBold,
  italic: StandardFonts.TimesRomanItalic,
  boldItalic: StandardFonts.TimesRomanBoldItalic,
  mono: StandardFonts.Courier,
};

export interface MarkdownPdfOptions {
  readonly setup?: PageSetup;
  readonly title?: string;
}

export async function markdownToPdf(
  markdown: string,
  options: MarkdownPdfOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const setup = options.setup ?? A4_TEXT;

  const doc = await PDFDocument.create();
  if (options.title) doc.setTitle(toWinAnsi(options.title));

  const fonts = {} as Record<Style, PDFFont>;
  for (const [style, face] of Object.entries(FACES)) {
    fonts[style as Style] = await doc.embedFont(face);
  }

  const measure: MeasureRun = (text, style, size) =>
    fonts[style].widthOfTextAtSize(toWinAnsi(text), size);

  const pages = flowBlocks(toBlocks(markdown), setup, measure);
  const faint = rgb(0.62, 0.65, 0.63);

  for (const lines of pages) {
    const page = doc.addPage([setup.width, setup.height]);
    let y = setup.height - setup.margin;

    for (const line of lines) {
      y -= line.spaceBefore + line.size * setup.lineHeight;
      drawLine(page, line, y, setup, fonts, faint);
    }
  }

  return doc.save();
}

function drawLine(
  page: PDFPage,
  line: LaidLine,
  y: number,
  setup: PageSetup,
  fonts: Record<Style, PDFFont>,
  faint: ReturnType<typeof rgb>,
): void {
  const left = setup.margin + line.indent;

  if (line.rule) {
    page.drawLine({
      start: { x: setup.margin, y: y + line.size * 0.3 },
      end: { x: setup.width - setup.margin, y: y + line.size * 0.3 },
      thickness: 0.6,
      color: faint,
    });
    return;
  }

  if (line.columns && line.cells) {
    line.cells.forEach((cell, column) => {
      const x = setup.margin + (line.columns![column] ?? 0);
      drawRuns(page, cell, x, y, line.size, fonts, line.tableHeader === true);
    });
    if (line.tableHeader) {
      page.drawLine({
        start: { x: setup.margin, y: y - line.size * 0.35 },
        end: { x: setup.width - setup.margin, y: y - line.size * 0.35 },
        thickness: 0.6,
        color: faint,
      });
    }
    return;
  }

  if (line.quote) {
    // A rule down the left, because indentation alone reads as a nested list
    // item rather than as somebody else's words.
    page.drawLine({
      start: { x: setup.margin + line.size * 0.6, y: y - line.size * 0.25 },
      end: { x: setup.margin + line.size * 0.6, y: y + line.size * 0.95 },
      thickness: 1.5,
      color: faint,
    });
  }

  if (line.marker) {
    // Set just left of the text, in the indent the list item already carries.
    const width = fonts.regular.widthOfTextAtSize(line.marker, line.size);
    page.drawText(line.marker, {
      x: Math.max(setup.margin, left - width - line.size * 0.45),
      y,
      size: line.size,
      font: fonts.regular,
    });
  }

  drawRuns(page, line.runs, left, y, line.size, fonts, false);
}

function drawRuns(
  page: PDFPage,
  runs: readonly Run[],
  startX: number,
  y: number,
  size: number,
  fonts: Record<Style, PDFFont>,
  bold: boolean,
): void {
  let x = startX;
  for (const run of runs) {
    const style: Style = bold && run.style === 'regular' ? 'bold' : run.style;
    const font = fonts[style];
    const text = toWinAnsi(run.text);
    if (text !== '') page.drawText(text, { x, y, size, font });
    x += font.widthOfTextAtSize(text, size);
  }
}

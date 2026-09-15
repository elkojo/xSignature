/**
 * Markdown to PDF, with no converter to download.
 *
 * Five faces carry the whole thing: regular, bold, italic and bold-italic, plus
 * a monospace for code. They are bundled rather than PDF's built-in fourteen,
 * which need no font file at all and which are WinAnsi — one byte a character,
 * with no room for `ř` or `ě` or `ů`. Handed a Czech contract they wrote
 * `Uzav?ená` into the body of it and said nothing. The text stays text either
 * way, which is the property the whole document screen rests on; what changed
 * is that it is now the right text.
 *
 * It is a plain setting of the document, not typesetting: no hyphenation, no
 * widow control, no floats. For a letter, a memo or a set of notes — which is
 * what people put a signature on — that is the right amount of machinery.
 */
import { PDFDocument, rgb, type PDFPage } from '@cantoo/pdf-lib';

import { loadFaces, type Face } from '../fonts/faces';
import { drawEmbeddedText, embedType0, finishFont, type EmbeddedFont } from './embed/type0';
import { flowBlocks, type LaidLine, type MeasureRun } from './flow';
import { toBlocks, type Run, type Style } from './markdown';
import { A4_TEXT, type PageSetup } from './text';

/** Markdown's styles and the faces that set them are the same five. */
const STYLES: readonly Style[] = ['regular', 'bold', 'italic', 'boldItalic', 'mono'];

/**
 * Which faces a document actually asks for.
 *
 * Every embedded face costs the reader about 90 kB, so a memo with no code in
 * it should not carry a monospace and a document with nothing emphasised
 * should not carry an italic. Regular is always included: list markers and
 * fallbacks are set in it whether or not a run ever asks.
 */
function facesUsedBy(blocks: ReturnType<typeof toBlocks>): Style[] {
  const used = new Set<Style>(['regular']);
  for (const block of blocks) {
    for (const run of block.runs) used.add(run.style);
    for (const cell of block.cells ?? []) {
      for (const run of cell) used.add(run.style);
    }
    // A heading is set bold, and so is a table's header row, whatever their
    // own runs say.
    if (block.kind === 'heading' || block.header) used.add('bold');
  }
  return STYLES.filter((style) => used.has(style));
}

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
  if (options.title) doc.setTitle(options.title);

  const blocks = toBlocks(markdown);
  const wanted = facesUsedBy(blocks);

  const loaded = await loadFaces(wanted as readonly Face[]);
  const embedded = Object.fromEntries(
    wanted.map((style) => [style, embedType0(doc, loaded[style].font, loaded[style].bytes, loaded[style].name)]),
  ) as Partial<Record<Style, EmbeddedFont>>;

  // A style the document never used falls back to regular rather than to a
  // face nobody asked to download.
  const fonts = Object.fromEntries(
    STYLES.map((style) => [style, embedded[style] ?? embedded.regular!]),
  ) as Record<Style, EmbeddedFont>;

  const measure: MeasureRun = (text, style, size) => fonts[style].widthOfTextAtSize(text, size);

  const pages = flowBlocks(blocks, setup, measure);
  const faint = rgb(0.62, 0.65, 0.63);

  for (const lines of pages) {
    const page = doc.addPage([setup.width, setup.height]);
    let y = setup.height - setup.margin;

    for (const line of lines) {
      y -= line.spaceBefore + line.size * setup.lineHeight;
      drawLine(page, line, y, setup, fonts, faint);
    }
  }

  // Widths and the character maps can only be written once every glyph each
  // face was asked for is known, which is now.
  for (const style of wanted) finishFont(fonts[style]);

  return doc.save();
}

function drawLine(
  page: PDFPage,
  line: LaidLine,
  y: number,
  setup: PageSetup,
  fonts: Record<Style, EmbeddedFont>,
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
    drawEmbeddedText(page, fonts.regular, line.marker, {
      x: Math.max(setup.margin, left - width - line.size * 0.45),
      y,
      size: line.size,
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
  fonts: Record<Style, EmbeddedFont>,
  bold: boolean,
): void {
  let x = startX;
  for (const run of runs) {
    const style: Style = bold && run.style === 'regular' ? 'bold' : run.style;
    const font = fonts[style];
    if (run.text !== '') drawEmbeddedText(page, font, run.text, { x, y, size });
    x += font.widthOfTextAtSize(run.text, size);
  }
}

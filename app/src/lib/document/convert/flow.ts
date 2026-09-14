/**
 * Flowing blocks onto pages.
 *
 * The same job `text.ts` does for plain text, with two differences that matter:
 * a line can mix faces, so it is measured run by run rather than whole; and
 * blocks have their own size and spacing, so a page holds a varying number of
 * lines rather than a fixed one.
 *
 * Measuring is still passed in. Nothing here knows what a font is, which is
 * what lets the whole of it be tested with a measuring function that makes
 * every character one unit wide.
 */
import type { Block, Run, Style } from './markdown';
import type { PageSetup } from './text';

/** How wide a run is, in page units. */
export type MeasureRun = (text: string, style: Style, size: number) => number;

export interface LaidLine {
  readonly runs: readonly Run[];
  /** Left offset from the margin, for list indents and quotes. */
  readonly indent: number;
  readonly size: number;
  /** Blank space above this line. */
  readonly spaceBefore: number;
  /** Draw a rule instead of text. */
  readonly rule?: boolean;
  /** Shown to the left of the first line of a list item. */
  readonly marker?: string;
  /** A line of a table's header row, which is set in bold and underlined. */
  readonly tableHeader?: boolean;
  /** Part of a quotation, which is marked with a rule down its left side. */
  readonly quote?: boolean;
  /** Column offsets, when this line is a table row. */
  readonly columns?: readonly number[];
  /** One cell's worth of runs per column. */
  readonly cells?: readonly (readonly Run[])[];
}

/** How each kind of block is set. Sizes are multiples of the body size. */
function styleFor(block: Block, body: number): { size: number; before: number; indent: number } {
  switch (block.kind) {
    case 'heading': {
      const scale = [1.9, 1.5, 1.25, 1.1, 1, 1][Math.min(block.level, 6) - 1];
      return { size: body * scale, before: body * (block.level === 1 ? 0.9 : 1.2), indent: 0 };
    }
    case 'listItem':
      return { size: body, before: body * 0.3, indent: body * 1.6 * (block.level + 1) };
    case 'code':
      return { size: body * 0.92, before: 0, indent: body * 1.2 };
    case 'quote':
      return { size: body, before: body * 0.7, indent: body * 1.8 };
    case 'rule':
      return { size: body, before: body * 1.1, indent: 0 };
    case 'tableRow':
      return { size: body * 0.95, before: body * 0.2, indent: 0 };
    default:
      return { size: body, before: body * 0.75, indent: 0 };
  }
}

/**
 * Wrap styled runs to a width.
 *
 * Words are kept whole where they fit and split where they cannot, as in plain
 * text — but a word may straddle two runs of different faces, so the runs are
 * broken into words first and reassembled into lines afterwards, with each
 * word keeping the face it arrived with.
 */
export function wrapRuns(
  runs: readonly Run[],
  maxWidth: number,
  size: number,
  measure: MeasureRun,
): Run[][] {
  type Word = { text: string; style: Style; space: boolean };
  const words: Word[] = [];

  for (const run of runs) {
    const pieces = run.text.split(/(\s+)/).filter((piece) => piece !== '');
    for (const piece of pieces) {
      const isSpace = /^\s+$/.test(piece);
      // Every run of whitespace becomes exactly one space. Markdown wraps its
      // source freely, so a sentence broken over two lines arrives carrying a
      // newline — which would be drawn as a line break by the writer, and
      // would put a second gap between the words either side of it.
      words.push({ text: isSpace ? ' ' : piece, style: run.style, space: isSpace });
    }
  }

  const lines: Run[][] = [];
  let line: Run[] = [];
  let width = 0;

  const flush = () => {
    if (line.length > 0) lines.push(trimTrailingSpace(line));
    line = [];
    width = 0;
  };

  for (const word of words) {
    const wordWidth = measure(word.text, word.style, size);

    // A space at the start of a line is not worth carrying over.
    if (word.space && line.length === 0) continue;

    if (width + wordWidth <= maxWidth) {
      line.push({ text: word.text, style: word.style });
      width += wordWidth;
      continue;
    }

    // It does not fit on this line. Only flush if there is a line to flush —
    // an empty one means the word is too long for any line, and it falls
    // through to being cut below rather than being pushed on whole.
    if (line.length > 0) flush();
    if (word.space) continue;

    if (wordWidth <= maxWidth) {
      line.push({ text: word.text, style: word.style });
      width = wordWidth;
      continue;
    }

    // Too long for any line: cut it where it stops fitting.
    let piece = '';
    for (const character of word.text) {
      if (piece !== '' && measure(piece + character, word.style, size) > maxWidth) {
        lines.push([{ text: piece, style: word.style }]);
        piece = '';
      }
      piece += character;
    }
    line = [{ text: piece, style: word.style }];
    width = measure(piece, word.style, size);
  }

  flush();
  return lines.length > 0 ? lines : [[]];
}

function trimTrailingSpace(line: Run[]): Run[] {
  const out = [...line];
  while (out.length > 0 && /^\s+$/.test(out[out.length - 1].text)) out.pop();
  return out;
}

/**
 * Column positions for a table, from the widest cell in each column.
 *
 * Scaled down together when they overflow, so a wide table narrows rather than
 * running off the page.
 */
export function tableColumns(
  rows: readonly (readonly (readonly Run[])[])[],
  available: number,
  size: number,
  measure: MeasureRun,
): number[] {
  const count = Math.max(...rows.map((row) => row.length), 0);
  if (count === 0) return [];

  const widths = Array.from({ length: count }, (_, column) =>
    Math.max(
      ...rows.map((row) =>
        (row[column] ?? []).reduce((sum, run) => sum + measure(run.text, run.style, size), 0),
      ),
      size,
    ),
  );

  const gap = size * 1.2;
  const total = widths.reduce((sum, width) => sum + width, 0) + gap * (count - 1);
  const scale = total > available ? (available - gap * (count - 1)) / (total - gap * (count - 1)) : 1;

  const offsets: number[] = [];
  let at = 0;
  for (const width of widths) {
    offsets.push(at);
    at += width * scale + gap;
  }
  return offsets;
}

/** Lay every block out and cut the result into pages. */
export function flowBlocks(
  blocks: readonly Block[],
  setup: PageSetup,
  measure: MeasureRun,
): LaidLine[][] {
  const usableWidth = setup.width - setup.margin * 2;
  const usableHeight = setup.height - setup.margin * 2;

  const lines: LaidLine[] = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const { size, before, indent } = styleFor(block, setup.fontSize);
    const first = lines.length === 0;

    if (block.kind === 'rule') {
      lines.push({ runs: [], indent, size, spaceBefore: first ? 0 : before, rule: true });
      continue;
    }

    if (block.kind === 'tableRow') {
      // Measured against the whole table so the columns line up down the page,
      // not just within one row.
      const table = collectTable(blocks, index);
      const columns = tableColumns(table, usableWidth, size, measure);
      lines.push({
        runs: [],
        indent,
        size,
        spaceBefore: first ? 0 : before,
        tableHeader: block.header,
        columns,
        cells: block.cells ?? [],
      });
      continue;
    }

    const wrapped = wrapRuns(block.runs, usableWidth - indent, size, measure);
    wrapped.forEach((runs, line) => {
      lines.push({
        runs,
        indent,
        size,
        spaceBefore: line === 0 ? (first ? 0 : before) : 0,
        marker: line === 0 ? block.marker : undefined,
        quote: block.kind === 'quote' || undefined,
      });
    });
  }

  return paginate(lines, usableHeight, setup.lineHeight);
}

/** Every row of the table that starts at `from`, so columns can be sized once. */
function collectTable(
  blocks: readonly Block[],
  from: number,
): (readonly (readonly Run[])[])[] {
  let start = from;
  while (start > 0 && blocks[start - 1].kind === 'tableRow') start -= 1;

  const rows: (readonly (readonly Run[])[])[] = [];
  for (let at = start; at < blocks.length && blocks[at].kind === 'tableRow'; at += 1) {
    rows.push(blocks[at].cells ?? []);
  }
  return rows;
}

function paginate(lines: readonly LaidLine[], usableHeight: number, lineHeight: number): LaidLine[][] {
  const pages: LaidLine[][] = [];
  let page: LaidLine[] = [];
  let used = 0;

  for (const line of lines) {
    const height = line.size * lineHeight;
    const needed = height + line.spaceBefore;

    if (page.length > 0 && used + needed > usableHeight) {
      pages.push(page);
      // The space above a block is there to separate it from what came before.
      // At the top of a fresh page there is nothing before it.
      page = [{ ...line, spaceBefore: 0 }];
      used = height;
      continue;
    }

    page.push(line);
    used += needed;
  }

  if (page.length > 0) pages.push(page);
  return pages.length > 0 ? pages : [[]];
}

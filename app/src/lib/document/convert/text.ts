/**
 * Laying plain text out on pages.
 *
 * This exists so that dropping a text file does not cost a 28 MB converter.
 * A `.txt` needs wrapping and pagination and nothing else — there is no
 * structure in it to lose — so doing it here rather than sending it through a
 * document converter is both instant and honest about what it is doing.
 *
 * Measuring is passed in rather than done here. Text width depends entirely on
 * the font, which belongs to the PDF writer, and keeping that out means this
 * file can be tested with a measuring function that makes every character one
 * unit wide — so the wrapping rules can be checked without a font anywhere near
 * them.
 */

/** How wide a run of text is, in the same units as the page. */
export type Measure = (text: string) => number;

export interface PageSetup {
  readonly width: number;
  readonly height: number;
  readonly margin: number;
  readonly fontSize: number;
  /** Multiplier on the font size. */
  readonly lineHeight: number;
}

/** A4 with a generous margin, which is what a letter or a memo wants. */
export const A4_TEXT: PageSetup = {
  width: 595.28,
  height: 841.89,
  margin: 64,
  fontSize: 10.5,
  lineHeight: 1.45,
};

/**
 * Break a single line to fit a width.
 *
 * Words are kept whole where they fit. A word too long for the line on its own
 * — a URL, a file path, a column of dashes — is cut at the character rather
 * than allowed to run off the page, because a line that overflows the margin is
 * lost rather than ugly.
 *
 * An empty input yields one empty line, so a blank line in the source stays a
 * blank line in the output rather than disappearing.
 */
export function wrapLine(text: string, maxWidth: number, measure: Measure): string[] {
  if (text === '') return [''];

  const lines: string[] = [];
  let current = '';

  for (const word of text.split(' ')) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (measure(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current !== '') {
      lines.push(current);
      current = '';
    }

    if (measure(word) <= maxWidth) {
      current = word;
      continue;
    }

    // Too long even alone: cut it where it stops fitting.
    let piece = '';
    for (const character of word) {
      if (piece !== '' && measure(piece + character) > maxWidth) {
        lines.push(piece);
        piece = '';
      }
      piece += character;
    }
    current = piece;
  }

  if (current !== '') lines.push(current);
  return lines.length > 0 ? lines : [''];
}

/**
 * Normalise the line endings and tabs a text file might arrive with.
 *
 * Tabs become four spaces because a PDF has no tab stops to honour; leaving
 * them would put a single narrow gap where the writer meant a column.
 */
export function normalizeText(text: string): string {
  return text
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ');
}

/**
 * Wrap the whole text and cut it into pages.
 *
 * Trailing blank lines are dropped before paginating. A file that ends with a
 * dozen newlines is extremely common and would otherwise produce empty pages
 * that nobody asked for.
 */
export function layoutText(text: string, setup: PageSetup, measure: Measure): string[][] {
  const usableWidth = setup.width - setup.margin * 2;
  const usableHeight = setup.height - setup.margin * 2;
  const step = setup.fontSize * setup.lineHeight;
  const perPage = Math.max(1, Math.floor(usableHeight / step));

  const source = normalizeText(text).replace(/\n+$/, '');
  const wrapped = source
    .split('\n')
    .flatMap((line) => wrapLine(line, usableWidth, measure));

  // An empty file wraps to a single empty line, so it still produces one blank
  // page. That is deliberate: a document with no pages has nowhere to put a
  // signature, which is the only reason anyone is converting it.
  const pages: string[][] = [];
  for (let at = 0; at < wrapped.length; at += perPage) {
    pages.push(wrapped.slice(at, at + perPage));
  }
  return pages;
}

/** Where a line's baseline sits on the page, counting from the top. */
export function baselineFor(index: number, setup: PageSetup): number {
  return setup.height - setup.margin - setup.fontSize * (setup.lineHeight * index + 1);
}

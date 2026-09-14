import { describe, expect, it } from 'vitest';

import { A4_TEXT, baselineFor, layoutText, normalizeText, wrapLine, type Measure } from './text';

/** One unit per character, so the wrapping rules can be read off directly. */
const monospace: Measure = (text) => text.length;

describe('normalizeText', () => {
  it('accepts the line endings a text file actually arrives with', () => {
    expect(normalizeText('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  it('strips a byte order mark rather than printing it', () => {
    expect(normalizeText('﻿hello')).toBe('hello');
  });

  it('turns tabs into spaces, because a PDF has no tab stops', () => {
    expect(normalizeText('a\tb')).toBe('a    b');
  });
});

describe('wrapLine', () => {
  it('keeps words whole while they fit', () => {
    expect(wrapLine('the quick brown fox', 10, monospace)).toEqual(['the quick', 'brown fox']);
  });

  it('keeps an empty line, so blank lines survive', () => {
    expect(wrapLine('', 10, monospace)).toEqual(['']);
  });

  it('fills each line as far as it goes', () => {
    expect(wrapLine('aaa bbb ccc ddd', 7, monospace)).toEqual(['aaa bbb', 'ccc ddd']);
  });

  it('breaks a word that is too long for a line on its own', () => {
    // A URL or a long path would otherwise run off the page and be lost.
    expect(wrapLine('aaaaaaaaaaaa', 5, monospace)).toEqual(['aaaaa', 'aaaaa', 'aa']);
  });

  it('breaks a long word that follows ordinary text', () => {
    expect(wrapLine('hi aaaaaaaa', 5, monospace)).toEqual(['hi', 'aaaaa', 'aaa']);
  });

  it('never returns a line wider than the limit', () => {
    const text = 'short and then averyverylongwordindeed plus more words here';
    for (const line of wrapLine(text, 12, monospace)) {
      expect(monospace(line)).toBeLessThanOrEqual(12);
    }
  });
});

describe('layoutText', () => {
  const setup = { width: 100, height: 100, margin: 10, fontSize: 10, lineHeight: 1 };

  it('cuts the text into pages that fit', () => {
    // 80 units of height at 10 per line is 8 lines a page.
    const text = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const pages = layoutText(text, setup, monospace);

    expect(pages).toHaveLength(3);
    expect(pages[0]).toHaveLength(8);
    expect(pages[2]).toHaveLength(4);
  });

  it('gives an empty file one blank page anyway', () => {
    // A document with no pages has nowhere to put a signature.
    expect(layoutText('', setup, monospace)).toEqual([['']]);
  });

  it('does not make empty pages out of trailing newlines', () => {
    expect(layoutText('one\n\n\n\n\n\n\n\n\n\n\n\n\n\n', setup, monospace)).toHaveLength(1);
  });

  it('keeps blank lines inside the text as blank lines', () => {
    const pages = layoutText('one\n\ntwo', setup, monospace);
    expect(pages[0]).toEqual(['one', '', 'two']);
  });

  it('wraps against the usable width, not the paper width', () => {
    const wide = layoutText('aaaaaaaaaaaaaaaaaaaa', setup, monospace);
    // 100 wide less two 10pt margins is 80 units, so twenty characters fit.
    expect(wide[0]).toEqual(['aaaaaaaaaaaaaaaaaaaa']);

    const over = layoutText('a'.repeat(81), setup, monospace);
    expect(over[0]).toHaveLength(2);
  });

  it('fits a realistic page of A4 text', () => {
    const lines = layoutText('word '.repeat(4000), A4_TEXT, (t) => t.length * 5.2);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0].length).toBeGreaterThan(30);
    expect(lines[0].length).toBeLessThan(80);
  });
});

describe('baselineFor', () => {
  const setup = { width: 100, height: 100, margin: 10, fontSize: 10, lineHeight: 1 };

  it('puts the first line inside the top margin', () => {
    expect(baselineFor(0, setup)).toBe(80); // 100 - 10 margin - 10 for the line itself
  });

  it('steps down the page', () => {
    expect(baselineFor(0, setup) - baselineFor(1, setup)).toBe(10);
  });

  it('keeps the last line that fits above the bottom margin', () => {
    const perPage = 8;
    expect(baselineFor(perPage - 1, setup)).toBeGreaterThanOrEqual(setup.margin);
  });
});

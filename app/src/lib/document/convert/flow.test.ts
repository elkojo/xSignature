import { describe, expect, it } from 'vitest';

import { flowBlocks, tableColumns, wrapRuns, type MeasureRun } from './flow';
import type { Block, Run } from './markdown';
import type { PageSetup } from './text';

/** One unit per character at size 1, so the rules can be read off directly. */
const monospace: MeasureRun = (text, _style, size) => text.length * size;

const words = (line: Run[]) => line.map((run) => run.text).join('');
const run = (text: string, style: Run['style'] = 'regular'): Run => ({ text, style });

const setup: PageSetup = { width: 120, height: 100, margin: 10, fontSize: 1, lineHeight: 1 };

describe('wrapRuns', () => {
  it('wraps at word boundaries', () => {
    const lines = wrapRuns([run('the quick brown fox')], 10, 1, monospace);
    expect(lines.map(words)).toEqual(['the quick', 'brown fox']);
  });

  it('keeps each word in the face it arrived with', () => {
    const lines = wrapRuns([run('plain '), run('bold', 'bold')], 40, 1, monospace);
    expect(lines[0].map((r) => [r.text, r.style])).toEqual([
      ['plain', 'regular'],
      [' ', 'regular'],
      ['bold', 'bold'],
    ]);
  });

  it('collapses any whitespace to a single space', () => {
    // Markdown wraps its source freely, so a sentence arrives carrying newlines.
    // Drawn literally those become line breaks, and doubled spaces either side.
    const lines = wrapRuns([run('one\ntwo   three')], 100, 1, monospace);
    expect(words(lines[0])).toBe('one two three');
  });

  it('does not start a line with a space', () => {
    const lines = wrapRuns([run('aaaa bbbb cccc')], 4, 1, monospace);
    expect(lines.every((line) => !/^\s/.test(words(line)))).toBe(true);
  });

  it('breaks a word too long for any line', () => {
    const lines = wrapRuns([run('aaaaaaaaaa')], 4, 1, monospace);
    expect(lines.map(words)).toEqual(['aaaa', 'aaaa', 'aa']);
  });

  it('never returns a line wider than the limit', () => {
    const lines = wrapRuns([run('short then averyverylongtoken and more')], 9, 1, monospace);
    for (const line of lines) expect(words(line).length).toBeLessThanOrEqual(9);
  });
});

describe('tableColumns', () => {
  it('sizes each column to its widest cell', () => {
    const rows = [
      [[run('a')], [run('bbbbb')]],
      [[run('cccc')], [run('d')]],
    ];
    const columns = tableColumns(rows, 100, 1, monospace);

    expect(columns[0]).toBe(0);
    // First column is four wide, plus a gap of 1.2.
    expect(columns[1]).toBeCloseTo(5.2, 5);
  });

  it('narrows a wide table instead of running it off the page', () => {
    const rows = [[[run('x'.repeat(200))], [run('y'.repeat(200))]]];
    const columns = tableColumns(rows, 50, 1, monospace);
    expect(columns[1]).toBeLessThan(50);
  });

  it('has nothing to say about a table with no rows', () => {
    expect(tableColumns([], 100, 1, monospace)).toEqual([]);
  });
});

describe('flowBlocks', () => {
  const paragraph = (text: string): Block => ({ kind: 'paragraph', level: 0, runs: [run(text)] });

  it('gives the first line no space above it', () => {
    // The gap above a block separates it from what came before. At the top of a
    // page there is nothing before it.
    const [page] = flowBlocks([paragraph('hello')], setup, monospace);
    expect(page[0].spaceBefore).toBe(0);
  });

  it('starts a new page when the current one is full', () => {
    const many = Array.from({ length: 200 }, (_, i) => paragraph(`line ${i}`));
    const pages = flowBlocks(many, setup, monospace);
    expect(pages.length).toBeGreaterThan(1);
  });

  it('does not carry a block gap to the top of the next page', () => {
    const many = Array.from({ length: 200 }, (_, i) => paragraph(`line ${i}`));
    const pages = flowBlocks(many, setup, monospace);
    for (const page of pages) expect(page[0].spaceBefore).toBe(0);
  });

  it('keeps every page inside the printable height', () => {
    const many = Array.from({ length: 300 }, (_, i) => paragraph(`line ${i}`));
    const usable = setup.height - setup.margin * 2;

    for (const page of flowBlocks(many, setup, monospace)) {
      const used = page.reduce((sum, line) => sum + line.size * setup.lineHeight + line.spaceBefore, 0);
      expect(used).toBeLessThanOrEqual(usable);
    }
  });

  it('sets headings larger than body text', () => {
    const [page] = flowBlocks(
      [{ kind: 'heading', level: 1, runs: [run('Title')] }, paragraph('body')],
      setup,
      monospace,
    );
    expect(page[0].size).toBeGreaterThan(page[1].size);
  });

  it('indents a list item and gives it its marker once', () => {
    const [page] = flowBlocks(
      [{ kind: 'listItem', level: 0, marker: '•', runs: [run('a fairly long item that wraps')] }],
      { ...setup, width: 30 },
      monospace,
    );
    expect(page[0].indent).toBeGreaterThan(0);
    expect(page[0].marker).toBe('•');
    expect(page.slice(1).every((line) => line.marker === undefined)).toBe(true);
  });

  it('marks quotation lines so they can be ruled', () => {
    const [page] = flowBlocks([{ kind: 'quote', level: 0, runs: [run('said')] }], setup, monospace);
    expect(page[0].quote).toBe(true);
  });

  it('gives every row of one table the same columns', () => {
    const rows: Block[] = [
      { kind: 'tableRow', level: 0, header: true, runs: [], cells: [[run('head')], [run('x')]] },
      { kind: 'tableRow', level: 0, header: false, runs: [], cells: [[run('a')], [run('b')]] },
    ];
    const [page] = flowBlocks(rows, setup, monospace);
    expect(page[0].columns).toEqual(page[1].columns);
    expect(page[0].tableHeader).toBe(true);
  });

  it('returns one empty page for an empty document', () => {
    expect(flowBlocks([], setup, monospace)).toEqual([[]]);
  });
});

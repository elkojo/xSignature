import { describe, expect, it } from 'vitest';

import { toBlocks, type Block } from './markdown';

const text = (block: Block) => block.runs.map((run) => run.text).join('');
const kinds = (blocks: Block[]) => blocks.map((block) => block.kind);

describe('toBlocks', () => {
  it('keeps heading levels', () => {
    const blocks = toBlocks('# One\n\n## Two\n\n### Three\n');
    expect(kinds(blocks)).toEqual(['heading', 'heading', 'heading']);
    expect(blocks.map((b) => b.level)).toEqual([1, 2, 3]);
    expect(blocks.map(text)).toEqual(['One', 'Two', 'Three']);
  });

  it('carries emphasis through as styled runs', () => {
    const [paragraph] = toBlocks('Plain **bold** and *italic* and `code`.');
    expect(paragraph.runs.map((run) => [run.text, run.style])).toEqual([
      ['Plain ', 'regular'],
      ['bold', 'bold'],
      [' and ', 'regular'],
      ['italic', 'italic'],
      [' and ', 'regular'],
      ['code', 'mono'],
      ['.', 'regular'],
    ]);
  });

  it('combines nested emphasis rather than losing the outer one', () => {
    const [paragraph] = toBlocks('***both***');
    expect(paragraph.runs[0].style).toBe('boldItalic');
  });

  it('numbers an ordered list and bullets an unordered one', () => {
    const ordered = toBlocks('1. first\n2. second\n');
    expect(ordered.map((b) => b.marker)).toEqual(['1.', '2.']);

    const bulleted = toBlocks('- first\n- second\n');
    expect(bulleted.every((b) => b.marker === '•')).toBe(true);
  });

  it('starts an ordered list where the document does', () => {
    expect(toBlocks('7. seventh\n8. eighth\n').map((b) => b.marker)).toEqual(['7.', '8.']);
  });

  it('keeps nesting as a depth', () => {
    const blocks = toBlocks('- outer\n  - inner\n');
    expect(blocks.map((b) => b.level)).toEqual([0, 1]);
  });

  it('breaks a code block into one block per line, so it can span pages', () => {
    const blocks = toBlocks('```\nfirst\nsecond\nthird\n```\n');
    expect(kinds(blocks)).toEqual(['code', 'code', 'code']);
    expect(blocks.map(text)).toEqual(['first', 'second', 'third']);
    expect(blocks.every((b) => b.runs.every((r) => r.style === 'mono'))).toBe(true);
  });

  it('marks a quotation as a quotation', () => {
    expect(kinds(toBlocks('> quoted words\n'))).toEqual(['quote']);
  });

  it('reads a table as a header row and body rows', () => {
    const blocks = toBlocks('| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n');
    expect(kinds(blocks)).toEqual(['tableRow', 'tableRow', 'tableRow']);
    expect(blocks[0].header).toBe(true);
    expect(blocks[1].header).toBe(false);
    expect(blocks[1].cells?.map((cell) => cell.map((r) => r.text).join(''))).toEqual(['1', '2']);
  });

  it('keeps a link address, because a printed page cannot be clicked', () => {
    const [paragraph] = toBlocks('See [the terms](https://example.org/terms).');
    expect(text(paragraph)).toContain('the terms');
    expect(text(paragraph)).toContain('https://example.org/terms');
  });

  it('does not repeat an address that is already the text', () => {
    const [paragraph] = toBlocks('<https://example.org>');
    expect(text(paragraph).match(/example\.org/g)).toHaveLength(1);
  });

  it('says where an image was rather than silently dropping it', () => {
    // There is nothing to fetch it with, so the alt text is what survives.
    const [paragraph] = toBlocks('![a diagram](diagram.png)');
    expect(text(paragraph)).toBe('[image: a diagram]');
  });

  it('keeps a horizontal rule', () => {
    expect(kinds(toBlocks('a\n\n---\n\nb'))).toEqual(['paragraph', 'rule', 'paragraph']);
  });

  it('produces nothing at all for an empty document', () => {
    expect(toBlocks('')).toEqual([]);
    expect(toBlocks('\n\n   \n')).toEqual([]);
  });

  it('treats plain prose with no markup as one paragraph', () => {
    const blocks = toBlocks('Just some ordinary words.');
    expect(kinds(blocks)).toEqual(['paragraph']);
    expect(text(blocks[0])).toBe('Just some ordinary words.');
  });
});

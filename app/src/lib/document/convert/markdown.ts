/**
 * Markdown, reduced to the handful of shapes a page can hold.
 *
 * The parsing is done by `marked`, which implements CommonMark properly. What
 * happens here is the narrowing: a document tree with dozens of node types
 * becomes a flat run of blocks, each of which is something that can be drawn —
 * a heading, a paragraph, a list item, a line of code, a row of a table.
 *
 * Flattening rather than keeping the tree is deliberate. Laying out a page is
 * pagination, and pagination is easier over a sequence than over a hierarchy;
 * nesting survives as an indent level, which is all the page can show of it
 * anyway.
 *
 * What is dropped is dropped visibly. An image cannot be drawn by a converter
 * that has no way to fetch it, so its alt text is kept and the reader is told;
 * anything else unrecognised keeps its text rather than vanishing.
 */
import { marked, type Token, type Tokens } from 'marked';

/** Which of the four built-in faces a run is set in. */
export type Style = 'regular' | 'bold' | 'italic' | 'boldItalic' | 'mono';

export interface Run {
  readonly text: string;
  readonly style: Style;
}

export type BlockKind =
  | 'heading'
  | 'paragraph'
  | 'listItem'
  | 'code'
  | 'quote'
  | 'rule'
  | 'tableRow';

export interface Block {
  readonly kind: BlockKind;
  /** Heading level 1-6, or nesting depth for a list item. */
  readonly level: number;
  /** The bullet or number shown before a list item. */
  readonly marker?: string;
  readonly runs: readonly Run[];
  /** For `tableRow`: the cells, and whether this is the header row. */
  readonly cells?: readonly (readonly Run[])[];
  readonly header?: boolean;
}

/** Combine an inherited style with a new one, so bold inside italic is both. */
function merge(base: Style, add: 'bold' | 'italic' | 'mono'): Style {
  if (add === 'mono') return 'mono';
  if (base === 'mono') return 'mono';

  const bold = add === 'bold' || base === 'bold' || base === 'boldItalic';
  const italic = add === 'italic' || base === 'italic' || base === 'boldItalic';
  if (bold && italic) return 'boldItalic';
  return bold ? 'bold' : italic ? 'italic' : 'regular';
}

/** Flatten inline tokens into styled runs. */
function inlineRuns(tokens: readonly Token[] | undefined, style: Style = 'regular'): Run[] {
  if (!tokens) return [];
  const runs: Run[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'strong':
        runs.push(...inlineRuns((token as Tokens.Strong).tokens, merge(style, 'bold')));
        break;
      case 'em':
        runs.push(...inlineRuns((token as Tokens.Em).tokens, merge(style, 'italic')));
        break;
      case 'codespan':
        runs.push({ text: (token as Tokens.Codespan).text, style: merge(style, 'mono') });
        break;
      case 'del':
        // No strikethrough in the built-in fonts, so it is marked in text
        // rather than silently shown as ordinary words.
        runs.push({ text: `[struck: ${(token as Tokens.Del).text}]`, style });
        break;
      case 'link': {
        const link = token as Tokens.Link;
        runs.push(...inlineRuns(link.tokens, style));
        // The address, because a printed page cannot be clicked.
        if (link.href && link.href !== link.text) {
          runs.push({ text: ` <${link.href}>`, style: merge(style, 'mono') });
        }
        break;
      }
      case 'image':
        runs.push({ text: `[image: ${(token as Tokens.Image).text || 'untitled'}]`, style });
        break;
      case 'br':
        runs.push({ text: ' ', style });
        break;
      default: {
        const text = (token as { text?: string; raw?: string }).text;
        const raw = (token as { raw?: string }).raw;
        if (text || raw) runs.push({ text: text ?? raw ?? '', style });
      }
    }
  }

  return runs.filter((run) => run.text !== '');
}

function listBlocks(list: Tokens.List, depth: number): Block[] {
  const blocks: Block[] = [];
  let counter = Number(list.start) || 1;

  for (const item of list.items) {
    const marker = list.ordered ? `${counter}.` : '•';
    counter += 1;

    // An item's own text, and then anything nested under it.
    const own: Token[] = [];
    const nested: Block[] = [];
    for (const token of item.tokens) {
      if (token.type === 'list') {
        nested.push(...listBlocks(token as Tokens.List, depth + 1));
      } else if (token.type === 'text' || token.type === 'paragraph') {
        own.push(...((token as Tokens.Text).tokens ?? [token]));
      } else {
        nested.push(...blocksFor(token, depth + 1));
      }
    }

    blocks.push({ kind: 'listItem', level: depth, marker, runs: inlineRuns(own) });
    blocks.push(...nested);
  }

  return blocks;
}

function blocksFor(token: Token, depth = 0): Block[] {
  switch (token.type) {
    case 'heading': {
      const heading = token as Tokens.Heading;
      return [{ kind: 'heading', level: heading.depth, runs: inlineRuns(heading.tokens) }];
    }
    case 'paragraph':
      return [{ kind: 'paragraph', level: depth, runs: inlineRuns((token as Tokens.Paragraph).tokens) }];
    case 'text': {
      const text = token as Tokens.Text;
      const runs = text.tokens ? inlineRuns(text.tokens) : [{ text: text.text, style: 'regular' as const }];
      return runs.length > 0 ? [{ kind: 'paragraph', level: depth, runs }] : [];
    }
    case 'list':
      return listBlocks(token as Tokens.List, depth);
    case 'code':
      // Each line of a code block is its own block, so a long one can break
      // across pages instead of being pushed whole onto the next.
      return (token as Tokens.Code).text
        .split('\n')
        .map((line) => ({ kind: 'code' as const, level: depth, runs: [{ text: line, style: 'mono' as const }] }));
    case 'blockquote':
      return (token as Tokens.Blockquote).tokens.flatMap((inner) =>
        blocksFor(inner, depth).map((block) => ({ ...block, kind: 'quote' as const })),
      );
    case 'hr':
      return [{ kind: 'rule', level: depth, runs: [] }];
    case 'table': {
      const table = token as Tokens.Table;
      const rows: Block[] = [
        {
          kind: 'tableRow',
          level: depth,
          header: true,
          runs: [],
          cells: table.header.map((cell) => inlineRuns(cell.tokens)),
        },
      ];
      for (const row of table.rows) {
        rows.push({
          kind: 'tableRow',
          level: depth,
          header: false,
          runs: [],
          cells: row.map((cell) => inlineRuns(cell.tokens)),
        });
      }
      return rows;
    }
    case 'space':
      return [];
    default: {
      const text = (token as { text?: string }).text;
      return text ? [{ kind: 'paragraph', level: depth, runs: [{ text, style: 'regular' }] }] : [];
    }
  }
}

/** Parse Markdown into the blocks a page can hold. */
export function toBlocks(markdown: string): Block[] {
  return marked.lexer(markdown).flatMap((token) => blocksFor(token));
}

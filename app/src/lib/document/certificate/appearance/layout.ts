/**
 * Where everything sits inside a visible signature block.
 *
 * Pure geometry, in the block's own coordinates: a box `width` by `height`
 * points, y-down like everything else this app measures ink in, turned the
 * right way up once when it is drawn. Nothing here knows about PDFs, fonts or
 * images — it is handed sizes and gives back rectangles, which is what makes it
 * testable without building a document.
 *
 * The block is two columns. The left holds the signature and, under it, a logo
 * if there is one; the right holds the details. When there is no text the left
 * column takes the whole width, because a block containing only a signature
 * should look like a signature rather than like a signature squeezed into half
 * a box.
 *
 * Each picture keeps its own proportions and is centred in the space it gets.
 * A signature stretched to fill a box is a different signature, and this app
 * does not do that anywhere else either.
 */

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Something with proportions to preserve. */
export interface Proportions {
  readonly width: number;
  readonly height: number;
}

export interface BlockInput {
  readonly width: number;
  readonly height: number;
  /** The signature's own proportions. */
  readonly signature: Proportions;
  /** The logo's, when the reader supplied one. */
  readonly logo?: Proportions;
  /** How many lines of detail there are. None means no right column. */
  readonly lines: number;
  /** Text size in points. The gap between lines follows from it. */
  readonly fontSize?: number;
}

export interface BlockLayout {
  readonly signature: Box;
  readonly logo: Box | null;
  /** Baselines for the detail lines, top to bottom. Empty when there are none. */
  readonly baselines: ReadonlyArray<{ x: number; y: number }>;
  /** The column the text sits in, for measuring how wide a line may be. */
  readonly textColumn: Box | null;
}

/** Breathing room inside the block's own border. */
const PADDING = 6;
/** Between the two columns. */
const GUTTER = 8;
/** Line height as a multiple of the font size. */
const LINE_RATIO = 1.32;
/** The left column's share of the width when there is text beside it. */
const LEFT_SHARE = 0.42;

/** Fit `what` inside `into`, keeping its proportions, centred. */
export function fitCentred(what: Proportions, into: Box): Box {
  if (what.width <= 0 || what.height <= 0 || into.width <= 0 || into.height <= 0) {
    return { x: into.x, y: into.y, width: 0, height: 0 };
  }

  const scale = Math.min(into.width / what.width, into.height / what.height);
  const width = what.width * scale;
  const height = what.height * scale;

  return {
    x: into.x + (into.width - width) / 2,
    y: into.y + (into.height - height) / 2,
    width,
    height,
  };
}

/**
 * Lay the block out.
 *
 * The text block is vertically centred on the whole inner height rather than
 * hung from the top: with one or two lines beside a signature, top alignment
 * reads as a mistake.
 */
export function layoutBlock(input: BlockInput): BlockLayout {
  const fontSize = input.fontSize ?? 7;
  const inner: Box = {
    x: PADDING,
    y: PADDING,
    width: Math.max(0, input.width - PADDING * 2),
    height: Math.max(0, input.height - PADDING * 2),
  };

  const hasText = input.lines > 0;
  const leftWidth = hasText ? inner.width * LEFT_SHARE - GUTTER / 2 : inner.width;

  // The logo, when there is one, takes a strip under the signature rather than
  // competing with it for the same space.
  const logoHeight = input.logo ? inner.height * 0.3 : 0;
  const signatureSpace: Box = {
    x: inner.x,
    y: inner.y,
    width: Math.max(0, leftWidth),
    height: Math.max(0, inner.height - logoHeight),
  };

  const signature = fitCentred(input.signature, signatureSpace);
  const logo = input.logo
    ? fitCentred(input.logo, {
        x: inner.x,
        y: inner.y + inner.height - logoHeight,
        width: Math.max(0, leftWidth),
        height: logoHeight,
      })
    : null;

  if (!hasText) return { signature, logo, baselines: [], textColumn: null };

  const textColumn: Box = {
    x: inner.x + inner.width * LEFT_SHARE + GUTTER / 2,
    y: inner.y,
    width: Math.max(0, inner.width * (1 - LEFT_SHARE) - GUTTER / 2),
    height: inner.height,
  };

  const lineHeight = fontSize * LINE_RATIO;
  const blockHeight = input.lines * lineHeight;
  const top = textColumn.y + Math.max(0, (textColumn.height - blockHeight) / 2);

  const baselines = Array.from({ length: input.lines }, (_, index) => ({
    x: textColumn.x,
    // The baseline sits a little below the line's top edge, by the share of the
    // line height that is above it in a typical face.
    y: top + index * lineHeight + fontSize * 0.8,
  }));

  return { signature, logo, baselines, textColumn };
}

/**
 * The lines of detail, in the order they are shown.
 *
 * Voluntary fields that were left empty produce no line at all, rather than a
 * label with nothing after it. The date is always shown when given: a signature
 * block without a date reads as though someone forgot it.
 */
export function detailLines(details: {
  name?: string;
  reason?: string;
  location?: string;
  date?: Date;
}): string[] {
  const lines: string[] = [];
  if (details.name?.trim()) lines.push(`Signed by: ${details.name.trim()}`);
  if (details.reason?.trim()) lines.push(details.reason.trim());
  if (details.location?.trim()) lines.push(details.location.trim());
  if (details.date) lines.push(details.date.toISOString().slice(0, 10));
  return lines;
}

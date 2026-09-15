/**
 * Drawing the visible signature block into a form XObject.
 *
 * Everything in the block is **outlines**, the text included. That is the same
 * decision the rest of this app makes about signatures, taken here for a
 * different reason: PDF's built-in fonts are WinAnsi, which cannot spell a
 * Czech name, and the certificates this feature exists for are Czech. A block
 * that renders "Ji?í Novák" on somebody's contract is not a block worth
 * drawing.
 *
 * So the details are set with the same bundled face the interface uses, turned
 * into glyph outlines by the same library that turns a typed signature into
 * one, and drawn as paths. The reader needs no font, the encoding question does
 * not arise, and a character the face cannot draw is reported rather than
 * silently replaced — `unsupportedCharacters` already does that job for
 * signature faces and does it here too.
 *
 * What this costs is selectable text. For a signature appearance that is a fair
 * trade: the same words are in the signature dictionary, where a reader shows
 * them as text in its own panel.
 *
 * A form XObject rather than page content, because the block belongs to the
 * signature. A reader that highlights signed fields highlights this, and a
 * reader showing signature properties can put this beside them.
 */
import {
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingColor,
  type PDFDocument,
  type PDFImage,
  type PDFOperator,
  type PDFRef,
} from '@cantoo/pdf-lib';
import type { Font } from 'opentype.js';

import type { PathCommand } from '../../../signature/path';
import { textToPath } from '../../../signature/type/text-to-path';
import { appearanceMatrix } from '../../place/placement';
import type { Rotation } from '../../place/placement';
import { hexToRgb } from '../../stamp/stamp';
import { pathOperators } from '../../stamp/path-ops';
import { detailLines, layoutBlock, type Box, type BlockLayout } from './layout';

/** The signature to show, in whichever form it arrived. */
export type BlockSignature =
  | { readonly kind: 'vector'; readonly commands: readonly PathCommand[]; readonly width: number; readonly height: number; readonly color: string }
  | { readonly kind: 'raster'; readonly image: PDFImage; readonly width: number; readonly height: number };

export interface BlockDetails {
  readonly name?: string;
  readonly reason?: string;
  readonly location?: string;
  readonly date?: Date;
}

export interface BlockOptions {
  readonly width: number;
  readonly height: number;
  readonly signature: BlockSignature;
  /** A picture the reader supplied. Never this app's own mark. */
  readonly logo?: PDFImage;
  readonly details: BlockDetails;
  /** The face the details are set in. */
  readonly font: Font;
  readonly fontSize?: number;
  /** Ink for the text. The signature carries its own. */
  readonly textColor?: string;
  /**
   * The page's `/Rotate`, so the block reads upright on a page stored turned.
   *
   * The block is laid out as the reader sees it — width is width on screen —
   * and this turns the result to match how the page is stored.
   */
  readonly rotation?: Rotation;
}

/**
 * y-down to y-up, for one box.
 *
 * Everything above is measured the way ink is measured in this app — top-left
 * origin, y increasing downwards — and a PDF's is the other way up. The flip
 * happens once, here, rather than being threaded through the layout.
 */
function toPdfSpace(box: Box, blockHeight: number): Box {
  return { ...box, y: blockHeight - box.y - box.height };
}

/** Draw a picture into a box, under its own name. */
function drawImage(
  key: string,
  box: Box,
  blockHeight: number,
): PDFOperator[] {
  const placed = toPdfSpace(box, blockHeight);
  if (placed.width <= 0 || placed.height <= 0) return [];

  return [
    pushGraphicsState(),
    concatTransformationMatrix(placed.width, 0, 0, placed.height, placed.x, placed.y),
    drawObject(key),
    popGraphicsState(),
  ];
}

/** Draw outlines that were measured in their own y-down box. */
function drawOutlines(
  commands: readonly PathCommand[],
  from: { width: number; height: number },
  box: Box,
  blockHeight: number,
  color: string,
): PDFOperator[] {
  const operators = pathOperators(commands);
  if (operators.length === 0 || from.width <= 0 || from.height <= 0) return [];

  const placed = toPdfSpace(box, blockHeight);
  const scaleX = placed.width / from.width;
  const scaleY = placed.height / from.height;
  const ink = hexToRgb(color);

  return [
    pushGraphicsState(),
    // Scale into the box, then flip: the commands are y-down from (0, 0), and
    // the box is already in the page's y-up space.
    concatTransformationMatrix(scaleX, 0, 0, -scaleY, placed.x, placed.y + placed.height),
    setFillingColor(rgb(ink.r, ink.g, ink.b)),
    ...operators,
    popGraphicsState(),
  ];
}

/**
 * The largest text size at which every line fits the column it is given.
 *
 * A form XObject is clipped to its bounding box, so a line too long for the
 * block does not overflow — it is cut off, mid-word, in a document somebody has
 * signed. That is the worst available behaviour: the signature is sound, and it
 * covers a reason that stops halfway through a sentence.
 *
 * So the size comes down until the longest line fits, to a floor. Below the
 * floor it would be too small to read, and the caller is told rather than
 * handed something illegible — `fits` is false and nothing has been hidden.
 */
export function fitTextSize(
  font: Font,
  lines: readonly string[],
  columnWidth: number,
  preferred: number,
  minimum = 4,
): { size: number; fits: boolean } {
  if (lines.length === 0 || columnWidth <= 0) return { size: preferred, fits: true };

  // Advance width scales linearly with the em size, so the size that fits can
  // be computed rather than searched for.
  const widest = Math.max(...lines.map((line) => font.getAdvanceWidth(line, preferred)));
  if (widest <= columnWidth) return { size: preferred, fits: true };

  const needed = (preferred * columnWidth) / widest;
  return { size: Math.max(needed, minimum), fits: needed >= minimum };
}

/**
 * Lay the block out at a size its text actually fits into.
 *
 * Two passes, and both are needed: the first finds how wide the text column is,
 * which depends on nothing but the block's own proportions, and the second lays
 * it out again at whatever size fits that column.
 *
 * Exported because the interface draws this block too, as a preview, and the
 * preview has to be the same shape as the page or it is not a preview. Having
 * two copies of this arithmetic is precisely how the preview came to draw text
 * at a size the page would never use.
 */
export function fitBlock(options: {
  readonly width: number;
  readonly height: number;
  readonly signature: { width: number; height: number };
  readonly logo?: { width: number; height: number };
  readonly lines: readonly string[];
  readonly font: Font;
  readonly fontSize?: number;
}): { layout: BlockLayout; fontSize: number; fits: boolean } {
  const preferred = options.fontSize ?? 7;
  const shape = (fontSize: number) =>
    layoutBlock({
      width: options.width,
      height: options.height,
      signature: options.signature,
      logo: options.logo,
      lines: options.lines.length,
      fontSize,
    });

  const provisional = shape(preferred);
  const fitted = fitTextSize(
    options.font,
    options.lines,
    provisional.textColumn?.width ?? 0,
    preferred,
  );

  return {
    layout: fitted.size === preferred ? provisional : shape(fitted.size),
    fontSize: fitted.size,
    fits: fitted.fits,
  };
}

/**
 * Build the appearance, and give back the reference to put in the widget.
 *
 * Registers whatever images the block needs as resources of the XObject itself,
 * so the block is self-contained — a page it is placed on needs to know nothing
 * about what is inside it.
 */
export function buildAppearance(doc: PDFDocument, options: BlockOptions): PDFRef {
  const { width, height, signature, logo, details, font } = options;
  const lines = detailLines(details);
  const { layout, fontSize } = fitBlock({
    width,
    height,
    signature: { width: signature.width, height: signature.height },
    logo: logo ? { width: logo.width, height: logo.height } : undefined,
    lines,
    font,
    fontSize: options.fontSize ?? 7,
  });

  const operators: PDFOperator[] = [];
  const resources: Record<string, unknown> = {};

  if (signature.kind === 'raster') {
    resources.XSigInk = signature.image.ref;
    operators.push(...drawImage('XSigInk', layout.signature, height));
  } else {
    operators.push(
      ...drawOutlines(
        signature.commands,
        { width: signature.width, height: signature.height },
        layout.signature,
        height,
        signature.color,
      ),
    );
  }

  if (logo && layout.logo) {
    resources.XSigLogo = logo.ref;
    operators.push(...drawImage('XSigLogo', layout.logo, height));
  }

  // The details, each line set at the baseline the layout worked out. Measured
  // in the same y-down space and flipped with the same helper, so a line of
  // text and the signature beside it cannot drift apart.
  const textColor = options.textColor ?? '#10201a';
  for (const [index, line] of lines.entries()) {
    const baseline = layout.baselines[index];
    if (!baseline) break;

    const commands = textToPath(font, line, { fontSize });
    if (commands.length === 0) continue;

    const ink = hexToRgb(textColor);
    operators.push(
      pushGraphicsState(),
      // textToPath puts the baseline at y = 0 and runs right from x = 0, in a
      // y-down space; one flip puts it the right way up where the layout asked.
      concatTransformationMatrix(1, 0, 0, -1, baseline.x, height - baseline.y),
      setFillingColor(rgb(ink.r, ink.g, ink.b)),
      ...pathOperators(commands),
      popGraphicsState(),
    );
  }

  const stream = doc.context.formXObject(operators, {
    BBox: doc.context.obj([0, 0, width, height]),
    Resources: doc.context.obj({
      XObject: doc.context.obj(resources as Parameters<typeof doc.context.obj>[0]),
    }),
    Matrix: doc.context.obj([...appearanceMatrix(options.rotation ?? 0)]),
  });

  return doc.context.register(stream);
}


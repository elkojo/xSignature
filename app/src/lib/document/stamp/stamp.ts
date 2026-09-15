/**
 * Putting the signature on the page.
 *
 * The whole placement is one `cm` matrix, computed by `place/placement`, so
 * nothing here does geometry — it pushes the graphics state, concatenates the
 * matrix, sets the ink colour, draws the outlines in their own coordinates and
 * pops the state again. Saving and restoring the state matters: without it the
 * matrix and the colour would leak into whatever the page draws afterwards, and
 * on a page whose content stream does not end cleanly that is visible damage.
 */
import {
  concatTransformationMatrix,
  drawObject,
  PDFName,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingColor,
  type PDFDocument,
  type PDFImage,
  type PDFOperator,
} from '@cantoo/pdf-lib';

import type { PathCommand } from '../../signature/path';
import {
  concat,
  placementMatrix,
  unitSquareToBox,
  type PageGeometry,
  type ViewRect,
} from '../place/placement';
import { pathOperators } from './path-ops';

export interface Stamp {
  /** Zero-based page index. */
  readonly page: number;
  /** Where on the displayed page, in fractions of it. */
  readonly rect: ViewRect;
  /** The ink, in its own y-down box starting at (0, 0). */
  readonly commands: readonly PathCommand[];
  readonly width: number;
  readonly height: number;
  /** `#rrggbb`. */
  readonly color: string;
}

/**
 * A picture put on the page instead of outlines.
 *
 * Everything about where it goes is the same — same rectangle, same page, same
 * rotation — because it runs through the same `placementMatrix`. The only
 * difference is one extra matrix in front of it, reconciling an image's
 * y-up unit square with the y-down space the ink is measured in.
 */
export interface ImageStamp {
  readonly page: number;
  readonly rect: ViewRect;
  readonly image: PDFImage;
  /** The picture's own proportions, which decide how it fits the rectangle. */
  readonly width: number;
  readonly height: number;
}

/**
 * `#rgb` or `#rrggbb` to the 0–1 components PDF wants.
 *
 * Anything else gives black. The writer rejects a component that is not a
 * number, so an unparseable colour would otherwise throw from somewhere deep
 * inside it and surface as "this document could not be written" — which is
 * both wrong and unactionable. Black is a colour; the shape is what matters.
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.trim().replace(/^#/, '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;

  if (!/^[0-9a-f]{6}$/i.test(full)) return { r: 0, g: 0, b: 0 };

  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255,
  };
}

/**
 * Everything the stamp adds to a page's content stream, in order.
 *
 * Separate from writing it so the operators can be read back and checked
 * without going near a saved file — content streams are compressed on the way
 * out, so bytes are no way to find out what was drawn.
 *
 * Empty when there is no ink: a bare save-and-restore pair would still be a
 * modification to someone's document, and writing one for nothing is worse
 * than writing nothing.
 */
export function stampOperators(geometry: PageGeometry, stamp: Stamp): PDFOperator[] {
  const commands = pathOperators(stamp.commands);
  if (commands.length === 0) return [];

  const [a, b, c, d, e, f] = placementMatrix(geometry, stamp.rect, {
    width: stamp.width,
    height: stamp.height,
  });
  const ink = hexToRgb(stamp.color);

  return [
    pushGraphicsState(),
    concatTransformationMatrix(a, b, c, d, e, f),
    setFillingColor(rgb(ink.r, ink.g, ink.b)),
    ...commands,
    popGraphicsState(),
  ];
}

/**
 * Draw one stamp onto one page of an already-open document.
 *
 * Mutates the document, which is what the library's page objects are for; the
 * caller decides when to save.
 */
export function applyStamp(doc: PDFDocument, geometry: PageGeometry, stamp: Stamp): void {
  const operators = stampOperators(geometry, stamp);
  if (operators.length === 0) return;

  doc.getPage(stamp.page).pushOperators(...operators);
}

/**
 * Draw an embedded picture onto a page.
 *
 * The image has to be registered on the page as a named resource before it can
 * be drawn, which is why this cannot be a pure operator list like the outline
 * path is — the name has to exist in the page's dictionary too.
 */
export function applyImageStamp(doc: PDFDocument, geometry: PageGeometry, stamp: ImageStamp): void {
  if (stamp.width <= 0 || stamp.height <= 0) return;

  const page = doc.getPage(stamp.page);

  // A name nothing else on the page is using. Two signatures on one page would
  // otherwise resolve to whichever was registered last.
  const key = `XSigImage${Math.random().toString(36).slice(2, 10)}`;
  page.node.setXObject(PDFName.of(key), stamp.image.ref);

  const placed = placementMatrix(geometry, stamp.rect, {
    width: stamp.width,
    height: stamp.height,
  });
  const [a, b, c, d, e, f] = concat(unitSquareToBox(stamp.width, stamp.height), placed);

  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(a, b, c, d, e, f),
    drawObject(key),
    popGraphicsState(),
  );
}

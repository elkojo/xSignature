/**
 * Where the signature lands on the page.
 *
 * Three coordinate systems meet here and none of them agree.
 *
 * - The **signature** is y-down, sitting in a box that starts at (0, 0), which
 *   is what `lib/signature/export/layout` hands over.
 * - The **page** is y-up, with its origin at the crop box's bottom-left corner,
 *   which may be nowhere near (0, 0) — a page cropped from a larger sheet
 *   carries the offset in its box.
 * - The **view** is y-down, and it is what the reader actually drags a box on.
 *   It is also *rotated*: a page carrying `/Rotate 90` is stored one way and
 *   displayed another, so the corner someone drags to is not the corner the
 *   page thinks it is.
 *
 * Getting this wrong is not subtle — a signature lands upside down, or off the
 * sheet, or ninety degrees out — but it is very easy, so the whole of it is
 * here, in one pure function with no PDF library anywhere near it.
 *
 * The answer is a single affine matrix in PDF's own `cm` order, `[a b c d e f]`,
 * meaning `x' = a·x + c·y + e` and `y' = b·x + d·y + f`. Emitting one matrix
 * rather than an x, a y and an angle means the caller has no geometry left to
 * get wrong, and it means every rotation is the same code path.
 */

/** A page as the viewer sees it: its crop box, and how it is turned. */
export interface PageGeometry {
  /** Crop box origin in PDF user space. Often (0, 0); not always. */
  readonly x: number;
  readonly y: number;
  /** Crop box size, before rotation. */
  readonly width: number;
  readonly height: number;
  /** `/Rotate`, normalized to 0, 90, 180 or 270. Clockwise, as PDF defines it. */
  readonly rotation: Rotation;
}

export type Rotation = 0 | 90 | 180 | 270;

/**
 * Where the reader put the box, as fractions of the *displayed* page.
 *
 * Fractions rather than pixels so the placement survives the preview being
 * re-rendered at another size — zooming the preview must not move the
 * signature.
 */
export interface ViewRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** PDF's `cm` matrix, in PDF's order. */
export type Matrix = readonly [number, number, number, number, number, number];

/** `/Rotate` may be any multiple of 90, positive or negative, or absent. */
export function normalizeRotation(raw: number | undefined): Rotation {
  const turns = Math.round((raw ?? 0) / 90) % 4;
  return ((turns < 0 ? turns + 4 : turns) * 90) as Rotation;
}

/** The page's size as displayed, which swaps on a quarter turn. */
export function displayedSize(page: PageGeometry): { width: number; height: number } {
  const turned = page.rotation === 90 || page.rotation === 270;
  return {
    width: turned ? page.height : page.width,
    height: turned ? page.width : page.height,
  };
}

/**
 * Fit a box of `width` × `height` inside `rect` without distorting it.
 *
 * A signature stretched to fill a dragged box stops looking like handwriting
 * immediately, so the drag sets the room available and this decides what is
 * actually used of it. The result is centred in the box on the axis it does
 * not fill.
 */
export function fitInside(
  rect: ViewRect,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number; scale: number } {
  if (width <= 0 || height <= 0) {
    return { x: rect.x, y: rect.y, width: 0, height: 0, scale: 0 };
  }

  const scale = Math.min(rect.width / width, rect.height / height);
  const fittedWidth = width * scale;
  const fittedHeight = height * scale;

  return {
    x: rect.x + (rect.width - fittedWidth) / 2,
    y: rect.y + (rect.height - fittedHeight) / 2,
    width: fittedWidth,
    height: fittedHeight,
    scale,
  };
}

/**
 * The matrix that carries signature coordinates onto the page.
 *
 * `rect` is in fractions of the displayed page; `signature` is the size of the
 * ink's own box in its own units. The signature keeps its aspect ratio, so it
 * is fitted inside the rectangle rather than stretched across it.
 *
 * Every one of the four results has a negative determinant. That is not a
 * mistake: the signature is y-down and the page is y-up, so exactly one flip is
 * always in play, whatever the rotation adds on top.
 */
export function placementMatrix(
  page: PageGeometry,
  rect: ViewRect,
  signature: { readonly width: number; readonly height: number },
): Matrix {
  const view = displayedSize(page);

  // The dragged box, in displayed points rather than fractions.
  const boxed: ViewRect = {
    x: rect.x * view.width,
    y: rect.y * view.height,
    width: rect.width * view.width,
    height: rect.height * view.height,
  };

  const fitted = fitInside(boxed, signature.width, signature.height);
  const s = fitted.scale;

  // Top-left of the ink, in displayed points.
  const dx = fitted.x;
  const dy = fitted.y;

  const { x: cx, y: cy, width: pw, height: ph } = page;

  switch (page.rotation) {
    case 0:
      // Display x runs with user x; display y runs against user y.
      return [s, 0, 0, -s, cx + dx, cy + ph - dy];
    case 90:
      // A quarter turn clockwise: display x is user y, display y is user x.
      return [0, s, s, 0, cx + dy, cy + dx];
    case 180:
      return [-s, 0, 0, s, cx + pw - dx, cy + dy];
    case 270:
      return [0, -s, -s, 0, cx + pw - dy, cy + ph - dx];
  }
}

/**
 * Multiply two `cm` matrices: `first`, then `second`.
 *
 * PDF composes transforms by concatenation, and the order is the one that
 * reads backwards: a point goes through `first` and then through `second`, so
 * `first` is the one written on the left here.
 */
export function concat(first: Matrix, second: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = first;
  const [a2, b2, c2, d2, e2, f2] = second;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

/**
 * The matrix that turns an image's unit square into a box of `width` × `height`
 * in the signature's own y-down space.
 *
 * PDF draws an image into the square from (0,0) to (1,1) with y running *up*,
 * so the top row of pixels is at y = 1. Everything else in this app measures
 * ink downwards from the top left. This is the one place that reconciles them,
 * and concatenating it before `placementMatrix` means an image lands exactly
 * where outlines of the same size would — same page, same rotation, same box.
 */
export function unitSquareToBox(width: number, height: number): Matrix {
  return [width, 0, 0, -height, 0, height];
}

/**
 * Where a display point lands in the page's own coordinates.
 *
 * The translation halves of `placementMatrix`, pulled out so that a rectangle
 * can be mapped as well as a signature. A display point is y-down from the top
 * left of the page *as shown*; what comes back is y-up in user space, crop box
 * offset included.
 */
function toUserSpace(page: PageGeometry, dx: number, dy: number): { x: number; y: number } {
  const { x: cx, y: cy, width: pw, height: ph } = page;

  switch (page.rotation) {
    case 0:
      return { x: cx + dx, y: cy + ph - dy };
    case 90:
      return { x: cx + dy, y: cy + dx };
    case 180:
      return { x: cx + pw - dx, y: cy + dy };
    case 270:
      return { x: cx + pw - dy, y: cy + ph - dx };
  }
}

/**
 * The rectangle an annotation needs, in the page's own coordinates.
 *
 * A widget's `/Rect` is axis-aligned in user space, but the reader dragged a box
 * on the page *as displayed* — and on a page stored rotated those are different
 * rectangles. All four corners are mapped and the bounding box taken, which is
 * the same rectangle for any rotation because a quarter turn maps a rectangle
 * to a rectangle.
 *
 * Returned in PDF's order, `[x1, y1, x2, y2]` with the lower-left corner first,
 * which is what a reader expects and what several will silently mis-draw if it
 * arrives the other way round.
 */
export function widgetRect(
  page: PageGeometry,
  rect: ViewRect,
): [number, number, number, number] {
  const view = displayedSize(page);
  const left = rect.x * view.width;
  const top = rect.y * view.height;
  const right = (rect.x + rect.width) * view.width;
  const bottom = (rect.y + rect.height) * view.height;

  const corners = [
    toUserSpace(page, left, top),
    toUserSpace(page, right, top),
    toUserSpace(page, right, bottom),
    toUserSpace(page, left, bottom),
  ];

  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);

  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * Where a point in the page's own coordinates lands on the display.
 *
 * The exact inverse of `toUserSpace`, and kept beside it so the two can be read
 * against each other. A display point is y-down from the top left of the page
 * *as shown*; what goes in is y-up in user space, crop box offset included.
 */
function toDisplaySpace(page: PageGeometry, x: number, y: number): { x: number; y: number } {
  const { x: cx, y: cy, width: pw, height: ph } = page;

  switch (page.rotation) {
    case 0:
      return { x: x - cx, y: cy + ph - y };
    case 90:
      return { x: y - cy, y: x - cx };
    case 180:
      return { x: cx + pw - x, y: y - cy };
    case 270:
      return { x: cy + ph - y, y: cx + pw - x };
  }
}

/**
 * Where an annotation already on the page sits, in fractions of the display.
 *
 * The inverse of `widgetRect`: that one takes a box the reader dragged and says
 * what rectangle to write, this one takes a rectangle already written and says
 * where to draw it. Needed because a signature being added has to be shown what
 * is already there — a rectangle overlapping an earlier signature is flagged by
 * validators as a way of hiding what was signed, and nobody can avoid a
 * rectangle they cannot see.
 *
 * All four corners are mapped and the bounding box taken, the same way round as
 * `widgetRect` does it, which makes the pair exactly invertible: a quarter turn
 * maps a rectangle to a rectangle.
 */
export function viewRectFromUserSpace(
  page: PageGeometry,
  rect: readonly [number, number, number, number],
): ViewRect {
  const view = displayedSize(page);
  const [x1, y1, x2, y2] = rect;

  const corners = [
    toDisplaySpace(page, x1, y1),
    toDisplaySpace(page, x2, y1),
    toDisplaySpace(page, x2, y2),
    toDisplaySpace(page, x1, y2),
  ];

  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);

  return {
    x: left / view.width,
    y: top / view.height,
    width: (Math.max(...xs) - left) / view.width,
    height: (Math.max(...ys) - top) / view.height,
  };
}

/**
 * The matrix that keeps an appearance upright on a page stored rotated.
 *
 * An annotation's appearance is drawn in the page's coordinates, and a reader
 * turns the whole page — content and annotations together — to display it. So
 * on a page carrying `/Rotate 90`, an appearance drawn the obvious way arrives
 * on its side. This turns it the other way first, so that what the reader sees
 * is the block the right way up.
 *
 * Only the rotation is given: a form's translation is worked out by the reader,
 * which maps the transformed bounding box into the annotation's rectangle.
 */
export function appearanceMatrix(rotation: Rotation): Matrix {
  switch (rotation) {
    case 0:
      return [1, 0, 0, 1, 0, 0];
    case 90:
      return [0, 1, -1, 0, 0, 0];
    case 180:
      return [-1, 0, 0, -1, 0, 0];
    case 270:
      return [0, -1, 1, 0, 0, 0];
  }
}

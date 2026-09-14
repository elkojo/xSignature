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

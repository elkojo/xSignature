import { boundsHeight, boundsWidth, type Bounds } from './bounds';

/**
 * How the ink is placed in the output, in user units at scale 1.
 *
 * This is the single source of truth for both exports. The SVG puts these
 * numbers in a viewBox and a transform; the PNG puts the same numbers into a
 * canvas size and a context transform. Neither computes its own geometry, which
 * is the whole reason the two files agree — every hosted competitor that
 * renders the SVG one way and the PNG another has two of these.
 */
export interface Layout {
  readonly width: number;
  readonly height: number;
  /** Added to every path coordinate to bring the ink inside the box. */
  readonly translateX: number;
  readonly translateY: number;
}

export interface LayoutOptions {
  /**
   * Margin on all four sides, as a fraction of the ink's height.
   *
   * Height rather than width, and the same figure on all four sides: a
   * signature is a line of writing, so its height is what reads as its size,
   * and a wide name would otherwise get a margin as long as itself. A ratio
   * rather than a fixed number so the margin survives being exported at 4×.
   */
  readonly padding: number;
}

/**
 * Trim to the ink, then give it room.
 *
 * Trimming is not a separate pass over pixels. The bounding box already says
 * exactly where the ink is, so moving it to the origin is a subtraction — there
 * is no transparent margin to detect and crop, because none was ever drawn.
 */
export function layout(bounds: Bounds, options: LayoutOptions): Layout {
  const margin = boundsHeight(bounds) * options.padding;

  return {
    width: boundsWidth(bounds) + margin * 2,
    height: boundsHeight(bounds) + margin * 2,
    translateX: margin - bounds.minX,
    translateY: margin - bounds.minY,
  };
}

/**
 * Whether a picture is actually big enough for where it is being put.
 *
 * The reason this exists rather than a blanket "PNGs are not vector" notice:
 * that notice would be true and useless. A signature copied at 4× is around
 * 2300 pixels wide; placed a couple of inches across a page that is over a
 * thousand dots per inch, which no printer resolves and no reader will ever
 * see. Warning about it teaches people to ignore warnings.
 *
 * What does go wrong is a small picture stretched large, and that is
 * arithmetic. So the question asked here is not "is this a PNG" but "how many
 * dots per inch does this work out to, as placed" — and nothing is said unless
 * the answer is genuinely poor.
 */

/** PDF's unit is 1/72 inch, which is where every conversion here starts. */
const POINTS_PER_INCH = 72;

/**
 * Below this, a signature looks visibly soft in print.
 *
 * Line art is less forgiving than a photograph — an edge that should be crisp
 * turns grey and furry — so this sits well above the 72 dpi that would be
 * merely "screen resolution".
 */
export const SOFT_BELOW_DPI = 150;

/** Above this there is nothing to say; it will out-resolve any printer. */
export const AMPLE_ABOVE_DPI = 300;

export type Sharpness = 'soft' | 'adequate' | 'ample';

export interface Resolution {
  readonly dpi: number;
  readonly sharpness: Sharpness;
}

/**
 * Effective resolution of `pixels` across `points` on the page.
 *
 * A zero or negative placement is not an error to shout about — it happens
 * while the reader is still dragging the size slider — so it comes back as
 * ample rather than as a failure.
 */
export function resolutionFor(pixels: number, points: number): Resolution {
  if (points <= 0 || pixels <= 0) return { dpi: Infinity, sharpness: 'ample' };

  const dpi = (pixels * POINTS_PER_INCH) / points;
  return {
    dpi,
    sharpness: dpi < SOFT_BELOW_DPI ? 'soft' : dpi < AMPLE_ABOVE_DPI ? 'adequate' : 'ample',
  };
}

/** Rounded the way a reader would say it, not to three decimals. */
export function describeDpi(dpi: number): string {
  if (!Number.isFinite(dpi)) return 'any size';
  if (dpi >= 1000) return `${Math.round(dpi / 100) * 100} dpi`;
  return `${Math.round(dpi / 10) * 10} dpi`;
}

/**
 * How much wider the picture would need to be to print cleanly where it is.
 *
 * Given so the advice is actionable: "copy it at 4× instead" is something the
 * reader can go and do, where "this is low resolution" is not.
 */
export function pixelsNeededFor(points: number): number {
  return Math.ceil((AMPLE_ABOVE_DPI * points) / POINTS_PER_INCH);
}

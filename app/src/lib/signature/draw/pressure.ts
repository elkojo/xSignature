import type { DrawnInk } from './segments';

/**
 * One recorded pointer sample, reduced to what pressure work needs.
 *
 * Declared here rather than imported from signature_pad so this module stays
 * pure data in and pure data out, and can be tested without the library.
 */
export interface PressurePoint {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
}

export interface PressureOptions {
  /**
   * How far the width is allowed to move for a full swing of pressure.
   *
   * 0.8 means a feather-light touch draws at 0.6× the speed-derived width and
   * a hard press at 1.4×. Enough to read as pressure, not so much that a
   * stylus produces a different signature from a mouse.
   */
  readonly strength?: number;
  /**
   * Below this much variation across the whole drawing, pressure is treated as
   * absent. A mouse reports the same number for every point — 0.5 in Chrome,
   * 0 elsewhere — and scaling by a constant would just resize the signature
   * while pretending to be something it is not.
   */
  readonly minimumRange?: number;
}

/** Is there any real pressure information here, or is it one flat number? */
export function pressureVaries(points: readonly PressurePoint[], minimumRange = 0.05): boolean {
  if (points.length < 2) return false;

  let low = Infinity;
  let high = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.pressure)) continue;
    if (point.pressure < low) low = point.pressure;
    if (point.pressure > high) high = point.pressure;
  }

  return Number.isFinite(low) && high - low >= minimumRange;
}

/**
 * Weight the stroke widths by how hard the pen was pressed.
 *
 * signature_pad records pressure on every sample and then never looks at it:
 * its width comes from velocity alone. So a stylus and a mouse produce
 * identical ink, which is not what someone with a stylus expects.
 *
 * Rather than reach into the library's private width calculation, this adjusts
 * the widths afterwards. Each curve is matched to the nearest recorded sample
 * by position — position being the one thing the two representations certainly
 * agree on, where indices and counts do not — and scaled by that sample's
 * pressure. Velocity still does most of the work; pressure leans on it.
 *
 * Returns the ink unchanged when there is no pressure to speak of, so a mouse
 * drawing is byte-for-byte what it was before this existed.
 */
export function applyPressure(
  ink: DrawnInk,
  points: readonly PressurePoint[],
  options: PressureOptions = {},
): DrawnInk {
  const strength = options.strength ?? 0.8;
  if (!pressureVaries(points, options.minimumRange ?? 0.05)) return ink;

  const scaleAt = (x: number, y: number): number => {
    let nearest = points[0];
    let best = Infinity;
    for (const point of points) {
      const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
      if (distance < best) {
        best = distance;
        nearest = point;
      }
    }

    const pressure = Number.isFinite(nearest.pressure) ? nearest.pressure : 0.5;
    // Around 0.5, so an unpressed sample leaves the width alone.
    return Math.max(0.25, 1 + (pressure - 0.5) * strength);
  };

  return {
    segments: ink.segments.map((segment) => ({
      ...segment,
      width: segment.width * scaleAt((segment.x0 + segment.x1) / 2, (segment.y0 + segment.y1) / 2),
    })),
    dots: ink.dots.map((dot) => ({ ...dot, radius: dot.radius * scaleAt(dot.x, dot.y) })),
  };
}

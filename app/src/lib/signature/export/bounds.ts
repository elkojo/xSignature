import type { PathCommand } from '../path';

/**
 * The rectangle a path actually occupies, in path coordinates.
 */
export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export const boundsWidth = (b: Bounds): number => b.maxX - b.minX;
export const boundsHeight = (b: Bounds): number => b.maxY - b.minY;

/** Where a quadratic curve turns back on itself, per axis. */
function quadraticExtremum(p0: number, p1: number, p2: number): number[] {
  const denominator = p0 - 2 * p1 + p2;
  // Straight in this axis: the curve is monotonic and the endpoints bound it.
  if (denominator === 0) return [];
  return [(p0 - p1) / denominator];
}

/** The same for a cubic, which can turn twice. */
function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  // B'(t)/3 = at² + bt + c
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;

  if (a === 0) return b === 0 ? [] : [-c / b];

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];

  const root = Math.sqrt(discriminant);
  return [(-b + root) / (2 * a), (-b - root) / (2 * a)];
}

const atQuadratic = (p0: number, p1: number, p2: number, t: number): number => {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * p1 + t * t * p2;
};

const atCubic = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};

/**
 * The true bounding box of a path.
 *
 * The tempting shortcut is to take the extent of every coordinate in the
 * command stream, control points included. That is the convex hull of the
 * control polygon, and it is always at least as large as the curve and usually
 * larger — a Bézier passes through its endpoints but only near its control
 * points. On a script face, where nearly every command is a curve, the
 * difference is visible: the signature would sit inside a box with slack on
 * every side, and the trim step exists precisely to remove that slack.
 *
 * So each curve is solved for the values of t where it stops moving in x or in
 * y, and only the points on the curve are measured.
 *
 * Returns null when the path draws nothing — an empty string, or a name typed
 * entirely in spaces. There is no meaningful box for no ink, and returning a
 * zero-sized one at the origin would send a divide-by-zero downstream.
 */
export function pathBounds(commands: readonly PathCommand[]): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;

  // x and y are widened separately: a curve's extreme x and its extreme y
  // occur at different values of t, and pairing one with the other's
  // coordinate would be measuring a point the curve never passes through.
  const includeX = (value: number) => {
    if (value < minX) minX = value;
    if (value > maxX) maxX = value;
  };
  const includeY = (value: number) => {
    if (value < minY) minY = value;
    if (value > maxY) maxY = value;
  };
  const include = (x: number, y: number) => {
    includeX(x);
    includeY(y);
    found = true;
  };

  // The pen, and the point the current contour started from.
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;

  for (const command of commands) {
    switch (command.type) {
      case 'M':
        // A moveto on its own marks no ink, but every contour that draws
        // anything starts with one, and normalize() has already removed the
        // ones that lead nowhere.
        include(command.x, command.y);
        x = startX = command.x;
        y = startY = command.y;
        break;

      case 'L':
        include(command.x, command.y);
        x = command.x;
        y = command.y;
        break;

      case 'Q': {
        include(command.x, command.y);
        for (const t of quadraticExtremum(x, command.x1, command.x)) {
          if (t > 0 && t < 1) includeX(atQuadratic(x, command.x1, command.x, t));
        }
        for (const t of quadraticExtremum(y, command.y1, command.y)) {
          if (t > 0 && t < 1) includeY(atQuadratic(y, command.y1, command.y, t));
        }
        x = command.x;
        y = command.y;
        break;
      }

      case 'C': {
        include(command.x, command.y);
        for (const t of cubicExtrema(x, command.x1, command.x2, command.x)) {
          if (t > 0 && t < 1) includeX(atCubic(x, command.x1, command.x2, command.x, t));
        }
        for (const t of cubicExtrema(y, command.y1, command.y2, command.y)) {
          if (t > 0 && t < 1) includeY(atCubic(y, command.y1, command.y2, command.y, t));
        }
        x = command.x;
        y = command.y;
        break;
      }

      case 'Z':
        x = startX;
        y = startY;
        break;
    }
  }

  return found ? { minX, minY, maxX, maxY } : null;
}

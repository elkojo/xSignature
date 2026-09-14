/**
 * The signature's outlines, as PDF content operators.
 *
 * This is the fourth renderer of the same `PathCommand[]` — after the SVG
 * builder, the canvas rasterizer and the on-screen preview — and it exists for
 * the same reason as the other three: the stamped PDF has to be the same
 * picture as the PNG and the SVG, not a fourth interpretation of the name.
 *
 * Two details keep it honest. The fill is **nonzero winding** (`f`, not `f*`),
 * matching what SVG and canvas do by default, because glyph outlines rely on
 * it — an even-odd fill hollows out every counter in the letters. And a
 * quadratic curve has to become a cubic one, because PDF has no quadratic
 * operator at all.
 */
import {
  appendBezierCurve,
  closePath,
  fill,
  lineTo,
  moveTo,
  type PDFOperator,
} from '@cantoo/pdf-lib';

import type { PathCommand } from '../../signature/path';

/**
 * The cubic that draws exactly the quadratic's curve.
 *
 * Exact, not approximate: every quadratic Bézier is a cubic one, with both
 * control points two thirds of the way from each end towards the quadratic's
 * single control point. TrueType glyphs are quadratic throughout, so this runs
 * on nearly every command of a typed name — an approximation here would show.
 */
export function quadraticToCubic(
  from: { x: number; y: number },
  control: { x: number; y: number },
  to: { x: number; y: number },
): { x1: number; y1: number; x2: number; y2: number } {
  return {
    x1: from.x + (2 / 3) * (control.x - from.x),
    y1: from.y + (2 / 3) * (control.y - from.y),
    x2: to.x + (2 / 3) * (control.x - to.x),
    y2: to.y + (2 / 3) * (control.y - to.y),
  };
}

/**
 * Turn the commands into path operators, ending with a single fill.
 *
 * One fill for the whole path rather than one per contour: a glyph's counters
 * are separate contours that have to be painted together for the winding rule
 * to cut the holes out of the letters.
 */
export function pathOperators(commands: readonly PathCommand[]): PDFOperator[] {
  const ops: PDFOperator[] = [];
  let x = 0;
  let y = 0;

  for (const command of commands) {
    switch (command.type) {
      case 'M':
        ops.push(moveTo(command.x, command.y));
        x = command.x;
        y = command.y;
        break;
      case 'L':
        ops.push(lineTo(command.x, command.y));
        x = command.x;
        y = command.y;
        break;
      case 'C':
        ops.push(
          appendBezierCurve(command.x1, command.y1, command.x2, command.y2, command.x, command.y),
        );
        x = command.x;
        y = command.y;
        break;
      case 'Q': {
        const c = quadraticToCubic(
          { x, y },
          { x: command.x1, y: command.y1 },
          { x: command.x, y: command.y },
        );
        ops.push(appendBezierCurve(c.x1, c.y1, c.x2, c.y2, command.x, command.y));
        x = command.x;
        y = command.y;
        break;
      }
      case 'Z':
        ops.push(closePath());
        break;
    }
  }

  if (ops.length > 0) ops.push(fill());
  return ops;
}

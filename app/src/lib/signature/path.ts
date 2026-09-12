/**
 * The one shape a signature has, whoever drew it.
 *
 * Typing a name and drawing one arrive by completely different routes — glyph
 * outlines from a font file, pointer samples from a screen — and they meet
 * here. Everything downstream (bounding box, trimming, SVG, PNG) reads this and
 * nothing else, which is what makes the PNG and the SVG the same picture rather
 * than two renderings that happen to look similar.
 *
 * The command set is deliberately the one opentype.js emits, so glyph outlines
 * pass through untouched and the conversion burden falls on the drawing side,
 * where the data is noisy anyway.
 *
 * Coordinates are in a y-down space, as SVG and canvas both use.
 */
export type PathCommand =
  | { readonly type: 'M'; readonly x: number; readonly y: number }
  | { readonly type: 'L'; readonly x: number; readonly y: number }
  | {
      readonly type: 'C';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly type: 'Q';
      readonly x1: number;
      readonly y1: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly type: 'Z' };

/** Does this command land exactly where the pen already is? */
function isDegenerate(command: PathCommand, x: number, y: number): boolean {
  switch (command.type) {
    case 'L':
      return command.x === x && command.y === y;
    case 'Q':
      return command.x === x && command.y === y && command.x1 === x && command.y1 === y;
    case 'C':
      return (
        command.x === x &&
        command.y === y &&
        command.x1 === x &&
        command.y1 === y &&
        command.x2 === x &&
        command.y2 === y
      );
    default:
      return false;
  }
}

/**
 * Drop commands that draw nothing, and close contours that come back to where
 * they started.
 *
 * Both are cleanups of what the font library hands over, and both matter more
 * than they look. Roughly a quarter of the commands in a typed name go nowhere:
 * an `L` to the point the pen is already on, emitted once per contour and again
 * at every on-curve point the outline passes through. They cost bytes in the
 * SVG and work in the rasterizer, and a zero-length segment is *not* drawn the
 * same way everywhere — with a round cap it is a dot in one renderer and
 * nothing in another, which is precisely the PNG-and-SVG divergence this
 * pipeline exists to prevent.
 *
 * Closing is the same argument. A filled contour closes implicitly, so for
 * typed text the `Z` changes no pixel; a stroked one does not, and draw mode
 * strokes. Making the closure explicit means one rule covers both.
 *
 * A contour left with nothing to draw is dropped outright, moveto and all: a
 * lone `M` moves the pen and marks no ink.
 *
 * Comparison is exact, not approximate. These duplicates are bit-identical —
 * the same font unit multiplied by the same scale — so an epsilon would buy
 * nothing and would risk deleting real, small geometry.
 */
export function normalize(commands: readonly PathCommand[]): PathCommand[] {
  const out: PathCommand[] = [];

  // Where the pen is, and where the current contour began.
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;

  // The `M` is held back until something actually draws, so a contour that
  // turns out to be empty takes its moveto with it when it goes.
  let pendingMove: PathCommand | null = null;
  let drew = false;

  const closeIfLooped = () => {
    if (drew && x === startX && y === startY) out.push({ type: 'Z' });
  };

  for (const command of commands) {
    if (command.type === 'Z') {
      if (drew) out.push(command);
      drew = false;
      pendingMove = null;
      continue;
    }

    if (command.type === 'M') {
      closeIfLooped();
      pendingMove = command;
      drew = false;
      x = startX = command.x;
      y = startY = command.y;
      continue;
    }

    if (isDegenerate(command, x, y)) continue;

    if (pendingMove) {
      out.push(pendingMove);
      pendingMove = null;
    }
    out.push(command);
    drew = true;
    x = command.x;
    y = command.y;
  }

  closeIfLooped();
  return out;
}

/**
 * Serialize to an SVG path `d` string.
 *
 * Coordinates are rounded to `precision` decimal places. Font units come out of
 * opentype at a scale where the fifteenth decimal is noise, and carrying that
 * noise into the file makes a signature's SVG several times larger than it
 * needs to be for a difference no one can see. Trailing zeros are dropped for
 * the same reason.
 */
export function toPathData(commands: readonly PathCommand[], precision = 2): string {
  const n = (value: number) => {
    const rounded = Number(value.toFixed(precision));
    // `-0` is a real number and a pointless character.
    return String(rounded === 0 ? 0 : rounded);
  };

  return commands
    .map((c) => {
      switch (c.type) {
        case 'M':
          return `M${n(c.x)} ${n(c.y)}`;
        case 'L':
          return `L${n(c.x)} ${n(c.y)}`;
        case 'C':
          return `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`;
        case 'Q':
          return `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}`;
        case 'Z':
          return 'Z';
      }
    })
    .join('');
}

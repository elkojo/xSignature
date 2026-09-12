/**
 * Dump a drawn signature to an SVG file, so the outlining can be looked at.
 *
 * The curves here are written by hand rather than captured from a pointer,
 * because signature_pad needs a canvas and there is no browser in a script.
 * Everything after the curves — grouping into strokes, offsetting, caps,
 * trimming, writing — is the code the app runs. For the real thing end to end,
 * including signature_pad's own smoothing, open scripts/draw-check.html.
 *
 *   npm run dump:draw
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { outlineInk } from '../src/lib/signature/draw/outline';
import type { DrawSegment } from '../src/lib/signature/draw/segments';
import { boundsHeight, boundsWidth, pathBounds } from '../src/lib/signature/export/bounds';
import { toSvg } from '../src/lib/signature/export/svg';

/** A flowing run of cubics, with the width swelling and thinning as a pen does. */
function run(x0: number, y0: number, count: number, step: number, phase: number): DrawSegment[] {
  const segments: DrawSegment[] = [];
  const at = (i: number) => ({
    x: x0 + i * step,
    y: y0 + Math.sin(i / 3.1 + phase) * 34 - i * 1.1,
  });

  for (let i = 0; i < count; i++) {
    const a = at(i);
    const b = at(i + 1);
    // Slower through the turns, so the line is heavier there.
    const width = 2.6 + Math.abs(Math.cos(i / 3.1 + phase)) * 3.4;
    segments.push({
      x0: a.x,
      y0: a.y,
      c1x: a.x + step / 3,
      c1y: a.y + (b.y - a.y) / 3,
      c2x: a.x + (step * 2) / 3,
      c2y: b.y - (b.y - a.y) / 3,
      x1: b.x,
      y1: b.y,
      width,
    });
  }

  return segments;
}

const ink = {
  segments: [...run(40, 130, 26, 11, 0), ...run(360, 120, 12, 9, 1.7)],
  dots: [{ x: 505, y: 118, radius: 2.4 }],
};

const commands = outlineInk(ink);
const svg = toSvg(commands, { padding: 0.08, color: '#12130f' });
if (!svg) throw new Error('no ink');

const out = fileURLToPath(new URL('../draw-dump.svg', import.meta.url));
writeFileSync(out, svg);

const box = pathBounds(commands)!;
console.log(`${ink.segments.length} curves + ${ink.dots.length} dot`);
console.log(`outline    : ${commands.length} commands, ${new Set(commands.map((c) => c.type)).size} kinds`);
console.log(`contours   : ${commands.filter((c) => c.type === 'M').length}`);
console.log(`ink        : ${boundsWidth(box).toFixed(1)} x ${boundsHeight(box).toFixed(1)}`);
console.log(`svg        : ${svg.length} bytes`);
console.log(out);

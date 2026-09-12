/**
 * Dump a typed name to an SVG file, so the outlines can be looked at directly.
 *
 * This is a development tool, not part of the app. It exists because the only
 * honest way to check the pipeline works is to open the result and see a
 * signature — a unit test can tell you the box is tight and the commands well
 * formed, but not that they spell someone's name.
 *
 * The font is read from disk rather than fetched, because there is no server
 * here. Everything after that is exactly the code the app runs.
 *
 *   npm run dump:type -- "Ada Lovelace"
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'opentype.js';

import { boundsHeight, boundsWidth, pathBounds } from '../src/lib/signature/export/bounds';
import { toSvg } from '../src/lib/signature/export/svg';
import { underlinePath } from '../src/lib/signature/flourish/underline';
import { textToPath } from '../src/lib/signature/type/text-to-path';

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const text = args[0] ?? 'Ada Lovelace';
const fontFile = args[1] ?? 'DancingScript-Regular.ttf';
const fontSize = 120;

const ttf = fileURLToPath(new URL(`../src/lib/signature/fonts/${fontFile}`, import.meta.url));
const font = parse(readFileSync(ttf).buffer);

const signature = textToPath(font, text, { fontSize });
const withFlourish = process.argv.includes('--flourish');
const signatureBox = pathBounds(signature);
const commands =
  withFlourish && signatureBox ? [...signature, ...underlinePath(signatureBox)] : signature;
const svg = toSvg(commands, { padding: 0.08, color: '#10201a' });

if (!svg) {
  console.error(`"${text}" draws no ink.`);
  process.exit(1);
}

const out = fileURLToPath(new URL('../type-dump.svg', import.meta.url));
writeFileSync(out, svg);

// What the box would have been without solving the curves: the extent of every
// number in the command stream, control points included.
const ink = pathBounds(commands)!;
let hullMinY = Infinity;
let hullMaxY = -Infinity;
for (const c of commands) {
  if (c.type === 'Z') continue;
  const ys = c.type === 'C' ? [c.y, c.y1, c.y2] : c.type === 'Q' ? [c.y, c.y1] : [c.y];
  for (const y of ys) {
    hullMinY = Math.min(hullMinY, y);
    hullMaxY = Math.max(hullMaxY, y);
  }
}

const tight = boundsHeight(ink);
const loose = hullMaxY - hullMinY;

console.log(`"${text}" — ${commands.length} commands, ${svg.length} bytes of SVG`);
console.log(`ink            : ${boundsWidth(ink).toFixed(1)} x ${tight.toFixed(1)}`);
console.log(`control hull   : ${loose.toFixed(1)} tall`);
console.log(`slack avoided  : ${(loose - tight).toFixed(1)} (${((loose / tight - 1) * 100).toFixed(1)}% taller)`);
console.log(out);

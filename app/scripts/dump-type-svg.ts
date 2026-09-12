/**
 * Dump a typed name to an SVG file, so the outlines can be looked at directly.
 *
 * This is a development tool, not part of the app. It exists because the only
 * honest way to check that text→path works is to open the result and see a
 * signature — a unit test can tell you the commands are well formed, but not
 * that they spell someone's name.
 *
 * The font is read from disk rather than fetched, because there is no server
 * here. Everything after that is exactly the code the app runs.
 *
 *   npx vite-node scripts/dump-type-svg.ts -- "Ada Lovelace"
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'opentype.js';

import { toPathData } from '../src/lib/signature/path';
import { textToPath } from '../src/lib/signature/type/text-to-path';

const text = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? 'Ada Lovelace';
const fontSize = 120;

const ttf = fileURLToPath(
  new URL('../src/lib/signature/fonts/DancingScript-Regular.ttf', import.meta.url),
);
const font = parse(readFileSync(ttf).buffer);

const commands = textToPath(font, text, { fontSize });
const d = toPathData(commands);

// Deliberately crude framing: this dump is for looking at the glyph outlines,
// and the real bounding box is the next step's job. A generous box and a
// visible baseline are more useful here than a tight one.
const width = font.getAdvanceWidth(text, fontSize);
const pad = fontSize;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width + pad * 2)}" height="${fontSize * 2.5}" viewBox="${-pad} ${-fontSize * 1.4} ${width + pad * 2} ${fontSize * 2.5}">
  <line x1="${-pad}" y1="0" x2="${width + pad}" y2="0" stroke="#d33" stroke-width="1"/>
  <path d="${d}" fill="#10201a"/>
</svg>
`;

const out = fileURLToPath(new URL('../type-dump.svg', import.meta.url));
writeFileSync(out, svg);

console.log(`"${text}" → ${commands.length} commands, advance width ${width.toFixed(1)}`);
console.log(out);

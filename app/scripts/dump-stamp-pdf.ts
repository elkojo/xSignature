/**
 * Stamp a name onto a generated PDF, at every page rotation, and write the
 * files out to be looked at.
 *
 * This is a development tool, not part of the app. It exists because the
 * placement maths can be entirely correct in a unit test and still put the
 * signature upside down on a real page — the tests check the matrix against a
 * relationship derived on paper, and this checks that relationship against a
 * PDF reader that has never heard of either.
 *
 * Open the results, or render them: `pdftoppm -png -r 60 out.pdf out` and look.
 *
 *   npm run dump:stamp -- "Ada Lovelace"
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { parse } from 'opentype.js';

import { applyStamp } from '../src/lib/document/stamp/stamp';
import {
  displayedSize,
  normalizeRotation,
  type Rotation,
} from '../src/lib/document/place/placement';
import { pageGeometries } from '../src/lib/document/pdf/inspect';
import { pathBounds } from '../src/lib/signature/export/bounds';
import { layout } from '../src/lib/signature/export/layout';
import { textToPath } from '../src/lib/signature/type/text-to-path';

const text = process.argv[2] ?? 'Ada Lovelace';
const fontPath = fileURLToPath(
  new URL('../src/lib/signature/fonts/DancingScript-Regular.ttf', import.meta.url),
);

const font = parse(readFileSync(fontPath).buffer as ArrayBuffer);
const commands = textToPath(font as never, text, { fontSize: 120 });
const bounds = pathBounds(commands);
if (!bounds) throw new Error(`"${text}" produced no outlines.`);
const box = layout(bounds, { padding: 0.08 });

// Near the bottom right, where a signature usually goes, and deliberately not
// centred: a mirrored or rotated placement would still land in the middle.
const rect = { x: 0.52, y: 0.72, width: 0.36, height: 0 };

for (const angle of [0, 90, 180, 270] as Rotation[]) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.setRotation({ type: 'degrees', angle } as never);

  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(`/Rotate ${angle} — the signature belongs at the lower right`, {
    x: 40,
    y: 790,
    size: 12,
    font: helvetica,
  });

  const geometry = pageGeometries(doc)[0];
  // Against the page as *displayed*, not as stored: on a quarter turn those
  // are not the same page, and using the stored size shrinks the signature.
  const view = displayedSize(geometry);
  const height = ((box.height / box.width) * rect.width * view.width) / view.height;

  applyStamp(doc, geometry, {
    page: 0,
    rect: { ...rect, height },
    commands,
    width: box.width,
    height: box.height,
    color: '#1f3a68',
  });

  const name = `stamp-rotate-${normalizeRotation(angle)}.pdf`;
  writeFileSync(name, await doc.save());
  console.log(`wrote ${name}`);
}

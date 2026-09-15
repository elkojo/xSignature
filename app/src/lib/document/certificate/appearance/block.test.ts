import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PDFArray, PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { parse, type Font } from 'opentype.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { unsupportedCharacters } from '../../../signature/type/coverage';
import { checkSignatures } from '../../verify/verify';
import { makeKeyFiles } from '../read/fixtures/make-keys';
import type { Identity } from '../read/identity';
import { readKeyFile } from '../read/read';
import { applyCertificateSignature } from '../sign/apply';
import { buildAppearance } from './block';

let font: Font;
let identity: Identity;

beforeAll(async () => {
  const ttf = readFileSync(fileURLToPath(new URL('./fonts/Inter-Regular-Latin.ttf', import.meta.url)));
  font = parse(ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength));

  const keys = await makeKeyFiles({ commonName: 'Jiří Novák' });
  [identity] = await readKeyFile('signer.p12', keys.modern, keys.password);
}, 30_000);

/** A signature shaped like a real one, as outlines. */
const ink = {
  kind: 'vector',
  commands: [
    { type: 'M', x: 0, y: 20 },
    { type: 'C', x1: 20, y1: 0, x2: 60, y2: 40, x: 80, y: 20 },
    { type: 'Z' },
  ],
  width: 80,
  height: 40,
  color: '#10201a',
} as const;

describe('the bundled text face', () => {
  it('can spell the names this feature exists for', async () => {
    // The reason this font is bundled at all. PDF's built-in faces are WinAnsi
    // and turn "Jiří Novák" into "Ji?í Novák"; the certificates this app was
    // built around are Czech.
    expect(unsupportedCharacters(font, 'Jiří Novák, Miloš Čermák, Zdeňka Růžičková')).toEqual([]);
    expect(unsupportedCharacters(font, 'Ćwikła, Gül, Ūsis, Nagy Ödön')).toEqual([]);
  });

  it('still reports what it cannot draw, rather than drawing a box', async () => {
    // The subset stops at Latin Extended-A. Beyond it the reader is told, the
    // same way they are told about a signature face that cannot spell a name.
    expect(unsupportedCharacters(font, 'Ярослав')).not.toEqual([]);
  });
});

describe('buildAppearance', () => {
  it('produces a self-contained form XObject', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);

    const ref = buildAppearance(doc, {
      width: 180,
      height: 54,
      signature: ink,
      details: { name: 'Jiří Novák', reason: 'Souhlasím', location: 'Praha', date: new Date() },
      font,
    });

    const stream = doc.context.lookup(ref) as unknown as { dict: PDFDict };
    expect(stream.dict.get(PDFName.of('Subtype'))?.toString()).toBe('/Form');
    expect(stream.dict.lookup(PDFName.of('BBox'), PDFArray).toString()).toBe('[ 0 0 180 54 ]');
    // Its own resources, so a page it lands on needs to know nothing about it.
    expect(stream.dict.get(PDFName.of('Resources'))).toBeDefined();
  });

  it('draws nothing at all when there is nothing to draw', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);

    const ref = buildAppearance(doc, {
      width: 180,
      height: 54,
      signature: { ...ink, commands: [] },
      details: {},
      font,
    });

    const stream = doc.context.lookup(ref) as unknown as { getContentsString?: () => string };
    expect(stream.getContentsString?.() ?? '').toBe('');
  });
});

describe('a visible signature, end to end', () => {
  async function signVisibly() {
    const base = await PDFDocument.create();
    base.addPage([595, 842]);
    const bytes = await base.save();

    const doc = await PDFDocument.load(bytes, { updateMetadata: false, forIncrementalUpdate: true });
    const appearance = buildAppearance(doc, {
      width: 180,
      height: 54,
      signature: ink,
      details: { name: 'Jiří Novák', reason: 'Souhlasím', location: 'Praha', date: new Date() },
      font,
    });

    // The appearance has to be part of the document the signature covers, so
    // it is built into the same one that is about to be signed.
    const withAppearance = await doc.commit({ useObjectStreams: false });

    return applyCertificateSignature(withAppearance, identity, {
      name: 'Jiří Novák',
      reason: 'Souhlasím',
      location: 'Praha',
      rect: [60, 60, 240, 114],
      appearance,
    });
  }

  it('puts the block where it was asked to, and covers it', async () => {
    const signed = await signVisibly();
    const doc = await PDFDocument.load(signed.bytes, { updateMetadata: false });

    const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
    const widget = annots.lookup(annots.size() - 1, PDFDict);

    expect(widget.lookup(PDFName.of('Rect'), PDFArray).toString()).toBe('[ 60 60 240 114 ]');
    expect(widget.lookup(PDFName.of('AP'), PDFDict).get(PDFName.of('N'))).toBeDefined();

    // And the signature still holds over the whole thing, appearance included.
    const [checked] = await checkSignatures(signed.bytes);
    expect(checked.verdict).toBe('intact');
    expect(checked.kind).toBe('signature');
  });

  it('carries the Czech text into the dictionary as well as onto the page', async () => {
    // What is drawn and what a reader shows in its properties panel have to be
    // the same words, or the document says two things.
    const signed = await signVisibly();
    const [checked] = await checkSignatures(signed.bytes);

    expect(checked.name).toBe('Jiří Novák');
    expect(checked.reason).toBe('Souhlasím');
    expect(checked.location).toBe('Praha');
  });

  it('is still an invisible signature when no rectangle is given', async () => {
    const base = await PDFDocument.create();
    base.addPage([595, 842]);
    const signed = await applyCertificateSignature(await base.save(), identity);
    const doc = await PDFDocument.load(signed.bytes, { updateMetadata: false });

    const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
    const widget = annots.lookup(0, PDFDict);

    expect(widget.lookup(PDFName.of('Rect'), PDFArray).toString()).toBe('[ 0 0 0 0 ]');
    expect(widget.get(PDFName.of('AP'))).toBeUndefined();
  });
});

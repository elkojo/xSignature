import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import { findSignatures, isDocumentTimestamp } from './find';
import { checkTimestamps } from './verify';

/**
 * A real timestamped PDF, produced by this app and stamped by DigiCert, kept so
 * the checker is tested against a genuine authority's output rather than
 * against something this project made up about it.
 */
const TIMESTAMPED = new Uint8Array(
  readFileSync(fileURLToPath(new URL('./fixtures/timestamped.pdf', import.meta.url))),
);

let plain: Uint8Array;
beforeAll(async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('No timestamp here.', { x: 64, y: 700, size: 12, font });
  plain = await doc.save();
});

describe('findSignatures', () => {
  it('finds the timestamp in a stamped file', () => {
    const found = findSignatures(TIMESTAMPED);

    expect(found).toHaveLength(1);
    expect(found[0].type).toBe('DocTimeStamp');
    expect(found[0].subFilter).toBe('ETSI.RFC3161');
    expect(isDocumentTimestamp(found[0])).toBe(true);
  });

  it('finds nothing in a document that has none', () => {
    expect(findSignatures(plain)).toEqual([]);
  });

  it('notices when the range reaches the end of the file', () => {
    expect(findSignatures(TIMESTAMPED)[0].coversToEndOfFile).toBe(true);
  });

  it('notices when something was appended after the signature', () => {
    // Content added after a signature is not covered by it, which is exactly
    // how a document is made to show one thing and be signed as another.
    const extended = new Uint8Array([...TIMESTAMPED, ...new TextEncoder().encode('% appended\n')]);
    expect(findSignatures(extended)[0].coversToEndOfFile).toBe(false);
  });

  it('is not fooled by the characters /ByteRange appearing in ordinary text', () => {
    const decoy = new TextEncoder().encode('%PDF-1.7\n(/ByteRange [1 2 3] is not a signature)\n');
    expect(findSignatures(decoy)).toEqual([]);
  });
});

describe('checkTimestamps', () => {
  it('reports an untouched document as intact', async () => {
    const [checked] = await checkTimestamps(TIMESTAMPED);

    expect(checked.verdict).toBe('intact');
    expect(checked.isTimestamp).toBe(true);
    expect(checked.time).toBeInstanceOf(Date);
    expect(checked.detail).toBe('');
  });

  it('names the signer exactly as the token states it', async () => {
    const [checked] = await checkTimestamps(TIMESTAMPED);
    expect(checked.signedBy).toMatch(/DigiCert/);
  });

  it('reports a changed document as altered, not as merely invalid', async () => {
    // The single most important case: one byte of the covered region moved.
    const tampered = new Uint8Array(TIMESTAMPED);
    const [, firstLength] = findSignatures(TIMESTAMPED)[0].byteRange;
    tampered[Math.floor(firstLength / 2)] ^= 0xff;

    const [checked] = await checkTimestamps(tampered);
    expect(checked.verdict).toBe('altered');
    expect(checked.detail).toMatch(/changed since it was timestamped/);
  });

  it('still reports the claimed time on an altered document', async () => {
    // Useful to the reader: it says when the file it no longer matches was made.
    const tampered = new Uint8Array(TIMESTAMPED);
    tampered[200] ^= 0xff;

    const [checked] = await checkTimestamps(tampered);
    expect(checked.time).toBeInstanceOf(Date);
  });

  it('reports a forged token as broken rather than as altered', async () => {
    // The document still matches, but the token's own signature does not.
    const forged = new Uint8Array(TIMESTAMPED);
    const [, firstLength] = findSignatures(TIMESTAMPED)[0].byteRange;
    // Flip a hex digit deep inside the token, well past its header.
    forged[firstLength + 2000] = forged[firstLength + 2000] === 0x41 ? 0x42 : 0x41;

    const [checked] = await checkTimestamps(forged);
    expect(['broken', 'unreadable']).toContain(checked.verdict);
  });

  it('returns nothing for a document with no timestamp', async () => {
    expect(await checkTimestamps(plain)).toEqual([]);
  });
});

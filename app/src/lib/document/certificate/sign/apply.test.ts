import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PDFArray, PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import { checkSignatures } from '../../verify/verify';
import { makeKeyFiles, type KeyFileSet } from '../read/fixtures/make-keys';
import { readKeyFile } from '../read/read';
import type { Identity } from '../read/identity';
import { applyCertificateSignature } from './apply';

let keys: KeyFileSet;
let identity: Identity;

beforeAll(async () => {
  keys = await makeKeyFiles({ commonName: 'Milan Seman' });
  [identity] = await readKeyFile('signer.p12', keys.modern, keys.password);
}, 30_000);

async function blank(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return doc.save();
}

const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

describe('applyCertificateSignature', () => {
  it('produces a signature this app can read back', async () => {
    // The gate for the whole feature: a signature nothing here can verify is
    // not finished, whatever a specification says about it.
    const signed = await applyCertificateSignature(await blank(), identity);
    const [checked, ...rest] = await checkSignatures(signed.bytes);

    expect(rest).toHaveLength(0);
    expect(checked.kind).toBe('signature');
    expect(checked.isTimestamp).toBe(false);
    expect(checked.verdict).toBe('intact');
    expect(checked.signedBy).toBe('Milan Seman');
    expect(checked.coversToEndOfFile).toBe(true);
  });

  it('writes a signature of identity, not a timestamp', async () => {
    const signed = await applyCertificateSignature(await blank(), identity);
    const text = latin1(signed.bytes);

    expect(text).toContain('/Type /Sig');
    expect(text).toContain('/SubFilter /ETSI.CAdES.detached');
    expect(text).not.toContain('/DocTimeStamp');
    expect(text).not.toContain('ETSI.RFC3161');
  });

  it('leaves the bytes that arrived exactly as they were', async () => {
    // An incremental update. The signature has to be able to describe the
    // document as it was received, which is impossible if it was rewritten.
    const base = await blank();
    const signed = await applyCertificateSignature(base, identity);

    expect(signed.bytes.length).toBeGreaterThan(base.length);
    expect(Array.from(signed.bytes.subarray(0, base.length))).toEqual(Array.from(base));
  });

  it('notices a single byte changed anywhere it covers', async () => {
    const signed = await applyCertificateSignature(await blank(), identity);
    const altered = signed.bytes.slice();

    // Somewhere in the document's own bytes, well before the token.
    altered[40] = altered[40] ^ 0x01;

    const [checked] = await checkSignatures(altered);
    expect(checked.verdict).toBe('altered');
    expect(checked.detail).toContain('changed since it was signed');
  });

  it('sees content appended after the signature as uncovered', async () => {
    // How a document is made to show one thing while being signed as another.
    const signed = await applyCertificateSignature(await blank(), identity);
    const extended = new Uint8Array(signed.bytes.length + 8);
    extended.set(signed.bytes);
    extended.set(new TextEncoder().encode('% appended'.slice(0, 8)), signed.bytes.length);

    const [checked] = await checkSignatures(extended);
    expect(checked.coversToEndOfFile).toBe(false);
  });

  it('carries the reason, location and name through to a reader', async () => {
    const signed = await applyCertificateSignature(await blank(), identity, {
      reason: 'I approve this (really)',
      location: 'Praha, CZ',
      name: 'Milan Seman',
    });

    const [checked] = await checkSignatures(signed.bytes);
    expect(checked.verdict).toBe('intact');
    // The parenthesis is the point: a reason is a sentence, and PDF escapes
    // brackets inside strings. Reading to the first `)` would truncate it.
    expect(checked.reason).toBe('I approve this (really)');
    expect(checked.location).toBe('Praha, CZ');
    expect(checked.name).toBe('Milan Seman');
  });

  it('leaves a field out rather than writing it empty', async () => {
    const signed = await applyCertificateSignature(await blank(), identity, {
      reason: '   ',
      name: 'Milan Seman',
    });
    const text = latin1(signed.bytes);

    expect(text).toContain('/Name (Milan Seman)');
    expect(text).not.toContain('/Reason');
    expect(text).not.toContain('/Location');
  });

  it('records the signer\'s own clock, and says whose clock it is', async () => {
    const when = new Date(Date.UTC(2026, 8, 15, 10, 30, 0));
    const signed = await applyCertificateSignature(await blank(), identity, { signingTime: when });

    expect(latin1(signed.bytes)).toContain('/M (D:20260915103000Z)');

    // The same moment, signed, so it cannot be edited without breaking this.
    const [checked] = await checkSignatures(signed.bytes);
    expect(checked.time?.toISOString()).toBe(when.toISOString());
  });

  it('attaches an invisible field and marks the form append-only', async () => {
    const signed = await applyCertificateSignature(await blank(), identity);
    const doc = await PDFDocument.load(signed.bytes, { updateMetadata: false });

    const acroForm = doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
    expect(acroForm.get(PDFName.of('SigFlags'))?.toString()).toBe('3');

    const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
    const widget = annots.lookup(0, PDFDict);
    expect(widget.get(PDFName.of('FT'))?.toString()).toBe('/Sig');
    expect(widget.lookup(PDFName.of('Rect'), PDFArray).toString()).toBe('[ 0 0 0 0 ]');
  });

  it('fits the space already reserved for it, with room to spare', async () => {
    // The number I said I would measure rather than guess. A leaf-only
    // certificate — which is what a PostSignum export turned out to be — plus
    // the CMS structure, against the 16 kB the reserve already holds.
    const signed = await applyCertificateSignature(await blank(), identity);

    expect(signed.token.length).toBeLessThan(8_192);
    expect(signed.token.length).toBeGreaterThan(1_000);
  });

  it('signs the same whichever container the key came out of', async () => {
    // The legacy route reaches the signer through node-forge. It must make the
    // same signature: the container is not part of what is signed.
    const [viaFallback] = await readKeyFile('old.p12', keys.legacy, keys.password);
    const when = new Date(Date.UTC(2026, 0, 1));

    const a = await applyCertificateSignature(await blank(), identity, { signingTime: when });
    const b = await applyCertificateSignature(await blank(), viaFallback, { signingTime: when });

    const [first] = await checkSignatures(a.bytes);
    const [second] = await checkSignatures(b.bytes);

    expect(first.verdict).toBe('intact');
    expect(second.verdict).toBe('intact');
    expect(second.signedBy).toBe(first.signedBy);
    expect([...b.token]).toEqual([...a.token]);
  });

  it('can sit beside a real document timestamp without either being disturbed', async () => {
    // A document that already carries a timestamp, signed afterwards. Both
    // claims are real — the timestamp is DigiCert's, captured once and
    // committed — and each covers a different stretch of the file.
    const timestamped = new Uint8Array(
      readFileSync(fileURLToPath(new URL('../../verify/fixtures/timestamped.pdf', import.meta.url))),
    );
    const signed = await applyCertificateSignature(timestamped, identity);
    const checked = await checkSignatures(signed.bytes);

    expect(checked).toHaveLength(2);

    const stamp = checked.find((entry) => entry.kind === 'timestamp');
    const signature = checked.find((entry) => entry.kind === 'signature');

    // The timestamp still verifies over the bytes it was taken across, and now
    // reaches only part of the file, because the signature came after it.
    expect(stamp?.verdict).toBe('intact');
    expect(stamp?.coversToEndOfFile).toBe(false);

    // The signature covers everything, the timestamp included.
    expect(signature?.verdict).toBe('intact');
    expect(signature?.signedBy).toBe('Milan Seman');
    expect(signature?.coversToEndOfFile).toBe(true);
  });
});

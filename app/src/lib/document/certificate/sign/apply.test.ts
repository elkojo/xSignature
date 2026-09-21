import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PDFArray, PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { ContentInfo, SignedData } from 'pkijs';
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
    // It is read back out of `/M`, which is the only place a PAdES signature
    // may state it.
    const [checked] = await checkSignatures(signed.bytes);
    expect(checked.time?.toISOString()).toBe(when.toISOString());
  });

  it('carries the signed attributes the PAdES baseline requires, and no others', async () => {
    // EN 319 142-1 forbids `signing-time` in the CMS: the clock belongs in
    // `/M`, checked above. A validator holding the baseline profile against a
    // file that carries both drops it to the older PAdES-BES, so its absence
    // is asserted rather than left to be noticed in somebody's validator.
    const signed = await applyCertificateSignature(await blank(), identity);
    const info = ContentInfo.fromBER(signed.token.slice().buffer as ArrayBuffer);
    const attributes = new SignedData({ schema: info.content }).signerInfos[0].signedAttrs
      ?.attributes;

    const types = (attributes ?? []).map((attribute) => attribute.type);
    expect(types).toEqual([
      '1.2.840.113549.1.9.3', // content-type
      '1.2.840.113549.1.9.4', // message-digest
      '1.2.840.113549.1.9.16.2.47', // signing-certificate-v2
    ]);
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

describe('a signature that carries its own timestamp', () => {
  /**
   * A real token from DigiCert, captured once and committed for the checker.
   *
   * It is over a different digest than this signature's value, which is the
   * point of using it here: the structure is a genuine authority's output, and
   * the imprint check has something real to fail against. Nothing reaches the
   * network — the token is bytes on disk.
   */
  const REAL_TOKEN = new Uint8Array(
    readFileSync(fileURLToPath(new URL('../../timestamp/fixtures/digicert-response.der', import.meta.url))),
  );

  /** A source that hands back that captured token instead of asking anyone. */
  async function captured() {
    const { TimeStampResp } = await import('pkijs');
    const reply = TimeStampResp.fromBER(REAL_TOKEN as unknown as ArrayBuffer);
    const token = new Uint8Array(reply.timeStampToken!.toSchema().toBER(false));

    return async () => ({
      token,
      time: new Date('2026-09-14T19:03:57.000Z'),
      policy: '2.16.840.1.114412.7.1',
      accuracySeconds: null,
    });
  }

  it('embeds the token without disturbing the signature', async () => {
    // An unsigned attribute is outside what the signature covers, which is the
    // only reason a timestamp over the signature can be attached at all. If it
    // were inside, adding it would break the thing it describes.
    const signed = await applyCertificateSignature(await blank(), identity, {
      timestamp: await captured(),
    });

    const [checked] = await checkSignatures(signed.bytes);
    expect(checked.verdict).toBe('intact');
    expect(checked.signedBy).toBe('Milan Seman');
  });

  it('reports the timestamp it carries, and who granted it', async () => {
    const signed = await applyCertificateSignature(await blank(), identity, {
      timestamp: await captured(),
    });

    const [checked] = await checkSignatures(signed.bytes);
    expect(checked.timestamp).not.toBeNull();
    expect(checked.timestamp!.time.toISOString()).toBe('2026-09-14T19:03:57.000Z');
    expect(checked.timestamp!.signedBy).toMatch(/DigiCert|Timestamp/i);
  });

  it('says when the token does not actually describe this signature', async () => {
    // The check that stops a token borrowed from somewhere else reading as
    // corroboration. This one is real, and is over another document entirely.
    const signed = await applyCertificateSignature(await blank(), identity, {
      timestamp: await captured(),
    });

    const [checked] = await checkSignatures(signed.bytes);
    expect(checked.timestamp!.coversSignature).toBe(false);
  });

  it('carries no timestamp when none was asked for', async () => {
    const signed = await applyCertificateSignature(await blank(), identity);
    const [checked] = await checkSignatures(signed.bytes);

    expect(checked.timestamp).toBeNull();
    expect(signed.timestamp).toBeNull();
  });

  it('still fits the reserved space with a real token inside it', async () => {
    // A signature grows by the whole token — several kilobytes with a chain in
    // it. This is the case the reserve was sized for.
    const plain = await applyCertificateSignature(await blank(), identity);
    const stamped = await applyCertificateSignature(await blank(), identity, {
      timestamp: await captured(),
    });

    expect(stamped.token.length).toBeGreaterThan(plain.token.length + 3_000);
    expect(stamped.token.length).toBeLessThan(16_384);
  });
});

describe('the certificates a signature carries', () => {
  it('embeds a chain supplied alongside a leaf-only key file', async () => {
    // The case a real certificate authority produces: the key file holds the
    // signer's certificate and nothing above it, so the issuers are added
    // separately and have to reach the signature.
    const { makeChain } = await import('../read/fixtures/make-keys');
    const { orderChain, readCertificates } = await import('../read/chain');
    const { Certificate } = await import('pkijs');

    const made = await makeChain();
    const [onlyLeaf] = await readKeyFile('leaf.p12', made.leafOnlyP12, made.password);
    expect(onlyLeaf.chain).toHaveLength(0);

    const issuers = orderChain(
      Certificate.fromBER(made.leaf.slice().buffer as ArrayBuffer),
      readCertificates(new TextEncoder().encode(made.bundlePem)),
    );

    const signed = await applyCertificateSignature(await blank(), { ...onlyLeaf, chain: issuers });
    const [checked] = await checkSignatures(signed.bytes);

    expect(checked.verdict).toBe('intact');
    // The signer plus the two above it.
    expect(checked.certificateCount).toBe(3);
  }, 60_000);

  it('carries only the signer when nothing was supplied', async () => {
    const signed = await applyCertificateSignature(await blank(), identity);
    const [checked] = await checkSignatures(signed.bytes);

    expect(checked.certificateCount).toBe(1);
  });
});

describe('counter-signing: a second party signing the same document', () => {
  it('leaves the first signature holding, byte for byte', async () => {
    // What a contract signed by two people actually is. The second signature is
    // appended, so every byte the first one covers is still there and still
    // says what it said.
    const keys = await makeKeyFiles({ commonName: 'Bob Druhý' });
    const [second] = await readKeyFile('b.p12', keys.modern, keys.password);

    const first = await applyCertificateSignature(await blank(), identity, { name: 'Alice' });
    const both = await applyCertificateSignature(first.bytes, second, { name: 'Bob' });

    expect(Array.from(both.bytes.subarray(0, first.bytes.length))).toEqual(
      Array.from(first.bytes),
    );

    const checked = await checkSignatures(both.bytes);
    expect(checked).toHaveLength(2);
    expect(checked.map((c) => c.verdict)).toEqual(['intact', 'intact']);
    expect(checked.map((c) => c.signedBy)).toEqual(['Milan Seman', 'Bob Druhý']);
  }, 60_000);

  it('gives the second signature a field name of its own', async () => {
    // Two fields sharing a name are one field to a reader, which would make the
    // second signature look like it had replaced the first.
    const keys = await makeKeyFiles({ commonName: 'Bob Druhý' });
    const [second] = await readKeyFile('b.p12', keys.modern, keys.password);

    const first = await applyCertificateSignature(await blank(), identity);
    const both = await applyCertificateSignature(first.bytes, second);
    const text = latin1(both.bytes);

    expect(text).toContain('(Signature)');
    expect(text).toContain('(Signature 2)');
  }, 60_000);

  it('covers everything the first signer signed, and then some', async () => {
    const keys = await makeKeyFiles({ commonName: 'Bob Druhý' });
    const [second] = await readKeyFile('b.p12', keys.modern, keys.password);

    const first = await applyCertificateSignature(await blank(), identity);
    const both = await applyCertificateSignature(first.bytes, second);
    const [alice, bob] = await checkSignatures(both.bytes);

    // Alice signed a prefix; Bob signed all of it including her signature.
    expect(alice.coversToEndOfFile).toBe(false);
    expect(bob.coversToEndOfFile).toBe(true);
    expect(bob.covers).toBeGreaterThan(alice.covers);
  }, 60_000);

  it('is destroyed — not merely invalidated — by a rewrite', async () => {
    // The reason nothing may be drawn on a signed page. The writer reassembles
    // the file, and the signature dictionaries do not come back.
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const first = await applyCertificateSignature(await blank(), identity);
    expect(await checkSignatures(first.bytes)).toHaveLength(1);

    const reloaded = await PDFDocument.load(first.bytes, { updateMetadata: false });
    expect(await checkSignatures(await reloaded.save())).toHaveLength(0);
  }, 60_000);
});

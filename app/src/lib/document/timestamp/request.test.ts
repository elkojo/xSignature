import { describe, expect, it } from 'vitest';

import { buildTimestampRequest, sha256, SHA256_OID } from './request';

const DIGEST = new Uint8Array(32).fill(7);

describe('sha256', () => {
  it('produces the known digest of a known string', async () => {
    const digest = await sha256(new TextEncoder().encode('abc'));
    expect(Buffer.from(digest).toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('buildTimestampRequest', () => {
  it('refuses a digest that is not SHA-256 sized', () => {
    expect(() => buildTimestampRequest(new Uint8Array(20))).toThrow(/32 bytes/);
  });

  it('produces a small request — the document does not go with it', () => {
    const { der } = buildTimestampRequest(DIGEST);
    // A few dozen bytes: version, algorithm, digest, nonce, certReq. If this
    // ever grows into the kilobytes, something is being sent that should not be.
    expect(der.length).toBeLessThan(120);
  });

  it('carries the digest, and only the digest, of the document', () => {
    const digest = new Uint8Array(32).map((_, i) => i + 1);
    const { der } = buildTimestampRequest(digest);
    const hex = Buffer.from(der).toString('hex');
    expect(hex).toContain(Buffer.from(digest).toString('hex'));
  });

  it('names SHA-256 as the algorithm', () => {
    const { der } = buildTimestampRequest(DIGEST);
    // 2.16.840.1.101.3.4.2.1 encodes as 608648016503040201.
    expect(Buffer.from(der).toString('hex')).toContain('608648016503040201');
    expect(SHA256_OID).toBe('2.16.840.1.101.3.4.2.1');
  });

  it('uses a fresh random nonce each time when none is given', () => {
    const a = buildTimestampRequest(DIGEST).nonce;
    const b = buildTimestampRequest(DIGEST).nonce;
    expect(Buffer.from(a).toString('hex')).not.toBe(Buffer.from(b).toString('hex'));
  });

  it('uses the nonce it was handed, so a reply can be checked against it', () => {
    const nonce = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const built = buildTimestampRequest(DIGEST, nonce);
    expect(built.nonce).toEqual(nonce);
    expect(Buffer.from(built.der).toString('hex')).toContain('0102030405060708');
  });
});

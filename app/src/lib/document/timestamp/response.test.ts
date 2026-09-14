import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PKIStatusInfo, TimeStampResp } from 'pkijs';
import { beforeAll, describe, expect, it } from 'vitest';

import { sha256 } from './request';
import { readTimestampResponse, TimestampRefused } from './response';

/**
 * A real reply from DigiCert, captured once. See the README beside it — the
 * point is to parse an authority's actual output rather than something this
 * project invented about it.
 */
const REPLY = new Uint8Array(
  readFileSync(fileURLToPath(new URL('./fixtures/digicert-response.der', import.meta.url))),
);
const NONCE = new Uint8Array([0x4d, 0x1a, 0x9c, 0x07, 0x55, 0xe3, 0x21, 0x68]);

let DIGEST: Uint8Array;
beforeAll(async () => {
  DIGEST = await sha256(new TextEncoder().encode('xSignature fixture document'));
});

const refusal = (status: number) =>
  new Uint8Array(new TimeStampResp({ status: new PKIStatusInfo({ status }) }).toSchema().toBER(false));

describe('readTimestampResponse', () => {
  it('reads a real authority reply', () => {
    const stamp = readTimestampResponse(REPLY, DIGEST, NONCE);

    expect(stamp.time.toISOString()).toBe('2026-09-14T19:03:57.000Z');
    expect(stamp.policy).toBe('2.16.840.1.114412.7.1');
  });

  it('returns a token big enough to carry the certificate chain', () => {
    // certReq was set on the request. Without the chain inside the token,
    // verifying the timestamp later means hunting for certificates first.
    expect(readTimestampResponse(REPLY, DIGEST, NONCE).token.length).toBeGreaterThan(3000);
  });

  it('refuses a reply for a different document', () => {
    const wrong = new Uint8Array(32).fill(9);
    expect(() => readTimestampResponse(REPLY, wrong, NONCE)).toThrow(TimestampRefused);
    expect(() => readTimestampResponse(REPLY, wrong, NONCE)).toThrow(/different document/);
  });

  it('refuses a reply that does not echo the nonce, which could be a replay', () => {
    const other = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]);
    expect(() => readTimestampResponse(REPLY, DIGEST, other)).toThrow(/replay/);
  });

  it('rejects a nonce that differs in only its last byte', () => {
    const nearly = new Uint8Array([0x4d, 0x1a, 0x9c, 0x07, 0x55, 0xe3, 0x21, 0x69]);
    expect(() => readTimestampResponse(REPLY, DIGEST, nearly)).toThrow(/replay/);
  });

  it('accepts a nonce whose encoding gained a leading zero', () => {
    // A nonce is an ASN.1 INTEGER, and an encoder may add a leading zero to
    // keep the value positive. Comparing raw bytes fails on good replies and
    // looks exactly like a replay, which it is not.
    expect(() => readTimestampResponse(REPLY, DIGEST, new Uint8Array([0, ...NONCE]))).not.toThrow();
  });

  it('refuses bytes that are not an RFC 3161 reply at all', () => {
    const junk = new TextEncoder().encode('<html>504 Gateway Timeout</html>');
    expect(() => readTimestampResponse(junk, DIGEST, NONCE)).toThrow(/not an RFC 3161/);
  });

  it('reports a refusal by the authority in its own terms', () => {
    expect(() => readTimestampResponse(refusal(2), DIGEST, NONCE)).toThrow(/rejected/);
    expect(() => readTimestampResponse(refusal(3), DIGEST, NONCE)).toThrow(/waiting/);
  });

  it('refuses a grant that carries no token', () => {
    expect(() => readTimestampResponse(refusal(0), DIGEST, NONCE)).toThrow(/no token/);
  });
});

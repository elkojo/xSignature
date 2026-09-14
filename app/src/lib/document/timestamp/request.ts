/**
 * Asking a timestamp authority what time it is, in the form RFC 3161 defines.
 *
 * What leaves the device is this request and nothing else: a version number, an
 * algorithm identifier, a random nonce, and a 32-byte SHA-256 of the finished
 * PDF. The document does not go, and the digest cannot be turned back into it —
 * that is the entire reason a timestamp can exist in an app that otherwise
 * sends nothing anywhere.
 */
import { Integer, OctetString } from 'asn1js';
import { AlgorithmIdentifier, MessageImprint, TimeStampReq } from 'pkijs';

/** SHA-256, the only digest this app asks for. */
export const SHA256_OID = '2.16.840.1.101.3.4.2.1';

export interface TimestampRequest {
  /** DER bytes to POST. */
  readonly der: Uint8Array;
  /** The nonce sent, which the reply has to echo back. */
  readonly nonce: Uint8Array;
}

/** SHA-256 of some bytes, via the platform's own crypto. */
export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return new Uint8Array(digest);
}

/**
 * Build the request for a digest.
 *
 * `certReq` is set so the authority returns its certificate chain inside the
 * token. It makes the reply several times larger, and it is not optional for
 * this app: without the chain, verifying the timestamp later means going and
 * finding the right certificates first, and a timestamp that only the issuer
 * can check is not open verification.
 *
 * The nonce is random and is checked against the reply. It is what stops a
 * recorded answer from an earlier request being replayed as if it were fresh.
 */
export function buildTimestampRequest(digest: Uint8Array, nonce?: Uint8Array): TimestampRequest {
  if (digest.length !== 32) {
    throw new Error(`A SHA-256 digest is 32 bytes; this one is ${digest.length}.`);
  }

  const chosen = nonce ?? crypto.getRandomValues(new Uint8Array(8));

  const request = new TimeStampReq({
    version: 1,
    messageImprint: new MessageImprint({
      hashAlgorithm: new AlgorithmIdentifier({ algorithmId: SHA256_OID }),
      hashedMessage: new OctetString({ valueHex: toArrayBuffer(digest) }),
    }),
    certReq: true,
    nonce: new Integer({ valueHex: toArrayBuffer(chosen) }),
  });

  return { der: new Uint8Array(request.toSchema().toBER(false)), nonce: chosen };
}

/** A copy in a plain ArrayBuffer, which is what the ASN.1 library wants. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

/**
 * Putting a document timestamp on a finished PDF, start to end.
 *
 * The order is the whole of it, and none of it is interchangeable:
 *
 *  1. append the empty timestamp dictionary, with the token's space reserved
 *  2. write the file out, and only then measure where that space landed
 *  3. name the two stretches either side of it in `/ByteRange`
 *  4. digest those two stretches
 *  5. ask an authority to sign the digest
 *  6. write the token into the space already reserved for it
 *
 * After step 4 the file cannot change by a single byte, which is why steps 3
 * and 6 are length-preserving overwrites rather than edits.
 *
 * If step 5 fails, nothing has been written anywhere: the caller still holds
 * the untimestamped PDF and can offer it as it is.
 */
import { PDFDocument } from '@cantoo/pdf-lib';

import {
  byteRangeFor,
  digestedBytes,
  findContentsSpan,
  spliceToken,
  writeByteRange,
} from './byte-range';
import { addDocTimeStampPlaceholder } from './doctimestamp';
import { fetchTimestamp } from './fetch';
import { buildTimestampRequest, sha256 } from './request';
import { readTimestampResponse, type Timestamp } from './response';

export interface TimestampedPdf {
  /** The whole file: the document as it arrived, with the timestamp appended. */
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly timestamp: Timestamp;
}

/** What actually goes over the network, so the interface can show it. */
export interface Outgoing {
  readonly url: string;
  readonly digestHex: string;
  readonly requestBytes: number;
}

export interface ApplyOptions {
  /** Called once the digest exists, before anything is sent. */
  readonly onOutgoing?: (outgoing: Outgoing) => void;
}

export async function applyDocTimeStamp(
  pdf: Uint8Array,
  url: string,
  options: ApplyOptions = {},
): Promise<TimestampedPdf> {
  // Appending, not rewriting: the bytes that came in stay exactly as they were,
  // which is what lets the timestamp describe the document as it was received.
  const doc = await PDFDocument.load(pdf, {
    updateMetadata: false,
    forIncrementalUpdate: true,
  });
  addDocTimeStampPlaceholder(doc);

  // `useObjectStreams: false` is not a preference. A signature dictionary may
  // not live inside a compressed object stream — a reader has to be able to
  // find `/Contents` in the file's plain bytes to skip over it, and so does the
  // code below.
  const withPlaceholder = await doc.commit({ useObjectStreams: false });

  const span = findContentsSpan(withPlaceholder);
  const range = byteRangeFor(span, withPlaceholder.length);
  writeByteRange(withPlaceholder, range);

  const digest = await sha256(digestedBytes(withPlaceholder, range));
  const { der, nonce } = buildTimestampRequest(digest);

  options.onOutgoing?.({ url, digestHex: toHex(digest), requestBytes: der.length });

  const reply = await fetchTimestamp(url, der);
  const timestamp = readTimestampResponse(reply, digest, nonce);

  spliceToken(withPlaceholder, span, timestamp.token);

  return { bytes: withPlaceholder, timestamp };
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

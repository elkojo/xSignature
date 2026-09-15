/**
 * Putting a certificate signature on a finished PDF, start to end.
 *
 * The order is the same one `timestamp/apply.ts` performs, and for the same
 * reason — a signature has to cover the file it lives in, which is only
 * possible if the file stops changing before the signature is made:
 *
 *  1. append the signature dictionary, with the token's space reserved
 *  2. write the file out, and only then measure where that space landed
 *  3. name the two stretches either side of it in `/ByteRange`
 *  4. join those two stretches
 *  5. sign them
 *  6. write the token into the space already reserved for it
 *
 * After step 4 the file cannot change by a single byte, which is why steps 3
 * and 6 are length-preserving overwrites rather than edits. This is also why
 * the signature goes on **after** the picture: a signature covers the bytes
 * that exist when it is made, and anything drawn afterwards would either fall
 * outside it or break it.
 *
 * If step 5 fails, nothing has been written anywhere and the caller still holds
 * the unsigned PDF.
 */
import { PDFDocument, type PDFRef } from '@cantoo/pdf-lib';

import { addSignatureField } from '../../pdf/sig-field';
import {
  byteRangeFor,
  digestedBytes,
  findContentsSpan,
  spliceToken,
  writeByteRange,
} from '../../timestamp/byte-range';
import { signDetached, type SigningMaterial } from './cms';
import { signatureDictionary, type SignatureDetails } from './signature-dict';

export interface SignedPdf {
  /** The whole file: the document as it arrived, with the signature appended. */
  readonly bytes: Uint8Array<ArrayBuffer>;
  /** The detached token that went into it, for anyone who wants to check it. */
  readonly token: Uint8Array;
  /** The bytes the signature covers, which is everything but the hole. */
  readonly covered: number;
}

export interface SignOptions extends SignatureDetails {
  /** Which page the field is attached to. Defaults to the first. */
  readonly page?: number;
  /**
   * Where a visible signature is drawn, in PDF user space on that page.
   *
   * Absent means an invisible signature: the field still exists and still
   * covers the document, but nothing is painted. That is a real choice rather
   * than a lesser one — an invisible signature makes exactly the same
   * assertion, and does not put a picture on a page that may not want one.
   */
  readonly rect?: readonly [number, number, number, number];
  /** The appearance stream to show in that rectangle. */
  readonly appearance?: PDFRef;
}

/** The token did not fit the space reserved for it, and nothing was written. */
export class SignatureTooLarge extends Error {
  constructor(
    readonly needed: number,
    readonly reserved: number,
  ) {
    super(
      `This signature is ${needed} bytes and the space reserved for it is ${reserved}. ` +
        'A certificate chain longer than expected is the usual cause.',
    );
    this.name = 'SignatureTooLarge';
  }
}

export async function applyCertificateSignature(
  pdf: Uint8Array,
  material: SigningMaterial,
  options: SignOptions = {},
): Promise<SignedPdf> {
  // Appending, not rewriting: the bytes that came in stay exactly as they were,
  // which is what lets the signature describe the document as it was received.
  const doc = await PDFDocument.load(pdf, {
    updateMetadata: false,
    forIncrementalUpdate: true,
  });

  const signingTime = options.signingTime ?? new Date();
  addSignatureField(doc, signatureDictionary(doc, { ...options, signingTime }), {
    page: options.page ?? 0,
    name: 'Signature',
    rect: options.rect,
    appearance: options.appearance,
  });

  // `useObjectStreams: false` is not a preference. A signature dictionary may
  // not live inside a compressed object stream — a reader has to be able to
  // find `/Contents` in the file's plain bytes to skip over it, and so does the
  // code below.
  const withPlaceholder = await doc.commit({ useObjectStreams: false });

  const span = findContentsSpan(withPlaceholder);
  const range = byteRangeFor(span, withPlaceholder.length);
  writeByteRange(withPlaceholder, range);

  const covered = digestedBytes(withPlaceholder, range);
  const token = await signDetached(covered, material, { signingTime });

  const room = (span.end - span.start - 2) / 2;
  if (token.length > room) throw new SignatureTooLarge(token.length, room);

  spliceToken(withPlaceholder, span, token);

  return { bytes: withPlaceholder, token, covered: covered.length };
}

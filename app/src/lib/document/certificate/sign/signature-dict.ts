/**
 * The `/Sig` dictionary: what the PDF says about the signature, in the clear.
 *
 * Everything here is readable without undoing any cryptography, and a reader
 * shows it in a properties panel. That makes it the honest half of the
 * signature and also the untrustworthy half: `/Name`, `/Reason` and `/Location`
 * are whatever the signer typed. They are covered by the signature — changing
 * one after the fact breaks it — so they cannot be altered by somebody else,
 * but nothing checks that they were true when written.
 *
 * `/M` is the same kind of claim: the signer's clock, asserted. The version of
 * that claim which means something comes from a timestamp authority, and is
 * attached separately.
 *
 * The fields are voluntary, and an empty one is left out of the dictionary
 * rather than written as an empty string. A reader that shows "Reason:" with
 * nothing after it is worse than one that does not show the row at all.
 */
import { PDFHexString, PDFName, PDFString, type PDFDict, type PDFDocument } from '@cantoo/pdf-lib';

import { CONTENTS_HEX_BYTES } from '../../timestamp/byte-range';

export interface SignatureDetails {
  /** Why the document was signed. Free text, voluntary. */
  readonly reason?: string;
  /** Where the signer was. Free text, voluntary. */
  readonly location?: string;
  /** Who signed, as they wish to be named. Voluntary. */
  readonly name?: string;
  /** The signer's clock. Defaults to now. */
  readonly signingTime?: Date;
}

/**
 * A PDF date string, `D:YYYYMMDDHHmmSS±HH'mm`.
 *
 * Written in UTC with an explicit `Z`, rather than in the machine's own zone.
 * A local offset would say roughly where the signer was, which is a thing to
 * disclose on purpose in `/Location` if at all, not to leak through a date
 * format.
 */
export function pdfDate(when: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return (
    `D:${pad(when.getUTCFullYear(), 4)}${pad(when.getUTCMonth() + 1)}${pad(when.getUTCDate())}` +
    `${pad(when.getUTCHours())}${pad(when.getUTCMinutes())}${pad(when.getUTCSeconds())}Z`
  );
}

/**
 * Build the signature dictionary, with its `/Contents` hole reserved.
 *
 * The hole and the `/ByteRange` placeholder are the same ones a document
 * timestamp reserves, and for the same reason: neither can be known until the
 * file has been written out and measured, and both are written at exactly the
 * length of what will replace them.
 */
export function signatureDictionary(doc: PDFDocument, details: SignatureDetails): PDFDict {
  const dictionary = doc.context.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    // The PAdES subtype. It says the token in /Contents is a detached CAdES
    // signature, which is what `cms.ts` builds.
    SubFilter: 'ETSI.CAdES.detached',
    Contents: PDFHexString.of('0'.repeat(CONTENTS_HEX_BYTES)),
    ByteRange: [0, 9_999_999_999, 9_999_999_999, 9_999_999_999],
    M: PDFString.of(pdfDate(details.signingTime ?? new Date())),
  });

  // Voluntary, and absent rather than empty when not given. A reader that
  // shows "Reason:" with nothing after it is worse than one that omits the row.
  const optional: ReadonlyArray<readonly [string, string | undefined]> = [
    ['Name', details.name],
    ['Reason', details.reason],
    ['Location', details.location],
  ];
  for (const [key, value] of optional) {
    if (value?.trim()) dictionary.set(PDFName.of(key), PDFString.of(value.trim()));
  }

  return dictionary;
}

/**
 * Adding a document timestamp to a PDF, in the form PAdES defines.
 *
 * This is deliberately **not** a signature of identity. A signature dictionary
 * of subtype `/ETSI.CAdES.detached` says a named person approved the document,
 * and needs a private key belonging to that person. A `/DocTimeStamp` of
 * subtype `/ETSI.RFC3161` says something much narrower and much more honest:
 * these exact bytes existed at this time, according to an authority that has
 * never heard of whoever made them. It needs no key, no certificate and no
 * identity, and it claims none.
 *
 * That distinction is why this module and `certificate/sign` are separate
 * things that share their plumbing rather than one thing with a flag. What
 * they share — the field, the widget, the form entry — is in
 * `pdf/sig-field.ts`. What differs is what the dictionary asserts, and that is
 * the part worth keeping apart.
 *
 * The timestamp is written as an **incremental update**: the original bytes are
 * left exactly as they were and the new objects are appended after them. That
 * is what lets the timestamp cover the document as it was received, and it is
 * why this module needs a PDF writer that appends rather than rewrites.
 */
import { PDFHexString, type PDFDocument, type PDFRef } from '@cantoo/pdf-lib';

import { addSignatureField } from '../pdf/sig-field';
import { CONTENTS_HEX_BYTES } from './byte-range';

/**
 * Append the empty timestamp dictionary and everything that has to point at it.
 *
 * The `/Contents` string is filled with zeros and the `/ByteRange` with a
 * placeholder, because neither can be known until the file has been written out
 * and measured. Both are the exact length of what will replace them.
 */
export function addDocTimeStampPlaceholder(doc: PDFDocument): PDFRef {
  const timestamp = doc.context.obj({
    Type: 'DocTimeStamp',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'ETSI.RFC3161',
    // A hex string of zeros; the writer emits it as `<0000…>`, which is the
    // hole the byte range will name.
    Contents: PDFHexString.of('0'.repeat(CONTENTS_HEX_BYTES)),
    // Four numbers wide enough that the real offsets will fit in the same
    // space. `BYTE_RANGE_PLACEHOLDER` spells out exactly how the writer
    // serializes this, because that text is what gets searched for and
    // overwritten once the file has been measured.
    ByteRange: [0, 9_999_999_999, 9_999_999_999, 9_999_999_999],
  });

  return addSignatureField(doc, timestamp, { page: 0, name: 'Timestamp' });
}

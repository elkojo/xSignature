/**
 * Adding a document timestamp to a PDF, in the form PAdES defines.
 *
 * This is deliberately **not** a signature. A signature dictionary of subtype
 * `/ETSI.CAdES.detached` says a named person approved the document, and needs a
 * private key belonging to that person. A `/DocTimeStamp` of subtype
 * `/ETSI.RFC3161` says something much narrower and much more honest: these
 * exact bytes existed at this time, according to an authority that has never
 * heard of whoever made them. It needs no key, no certificate and no identity,
 * and it claims none.
 *
 * That distinction is the whole reason this feature is allowed to exist here.
 * The app puts a picture of a signature on a document; it must not, anywhere,
 * produce something that asserts who signed it.
 *
 * The timestamp is written as an **incremental update**: the original bytes are
 * left exactly as they were and the new objects are appended after them. That
 * is what lets the timestamp cover the document as it was received, and it is
 * why this module needs a PDF writer that appends rather than rewrites.
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
} from '@cantoo/pdf-lib';

import { CONTENTS_HEX_BYTES } from './byte-range';

/** Print, and locked so a reader does not offer to move or edit the field. */
const ANNOTATION_FLAGS = 132;

/**
 * Append the empty timestamp dictionary and everything that has to point at it.
 *
 * The `/Contents` string is filled with zeros and the `/ByteRange` with a
 * placeholder, because neither can be known until the file has been written out
 * and measured. Both are the exact length of what will replace them.
 */
export function addDocTimeStampPlaceholder(doc: PDFDocument): PDFRef {
  const context = doc.context;

  // The timestamp itself. `/Contents` is a hex string of zeros; the writer
  // emits it as `<0000…>`, which is the hole the byte range will name.
  const timestamp = context.obj({
    Type: 'DocTimeStamp',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'ETSI.RFC3161',
    Contents: PDFHexString.of('0'.repeat(CONTENTS_HEX_BYTES)),
    // Four numbers wide enough that the real offsets will fit in the same
    // space. `BYTE_RANGE_PLACEHOLDER` spells out exactly how the writer
    // serializes this, because that text is what gets searched for and
    // overwritten once the file has been measured.
    ByteRange: [0, 9_999_999_999, 9_999_999_999, 9_999_999_999],
  });
  const timestampRef = context.register(timestamp);

  // An invisible widget, because a signature field has to be an annotation on a
  // page even when there is nothing to show. A zero-sized rectangle is the
  // conventional way to say "this field has no appearance".
  const field = context.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    Rect: [0, 0, 0, 0],
    F: ANNOTATION_FLAGS,
    T: PDFString.of(uniqueFieldName(doc)),
    V: timestampRef,
    P: doc.getPage(0).ref,
  });
  const fieldRef = context.register(field);

  attachToPage(doc, fieldRef);
  attachToAcroForm(doc, fieldRef);

  return timestampRef;
}

/** The widget has to be listed on the page it belongs to. */
function attachToPage(doc: PDFDocument, fieldRef: PDFRef): void {
  const page = doc.getPage(0).node;
  const annots = page.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (annots) {
    annots.push(fieldRef);
  } else {
    page.set(PDFName.of('Annots'), doc.context.obj([fieldRef]));
  }
}

/**
 * List the field on the document's form, creating one if there is none.
 *
 * `SigFlags` 3 is `SignaturesExist | AppendOnly`, which tells a reader that the
 * file carries a signature and that saving it any way other than by appending
 * would break it. It is the flag that makes a viewer warn rather than quietly
 * destroy the timestamp.
 */
function attachToAcroForm(doc: PDFDocument, fieldRef: PDFRef): void {
  const context = doc.context;
  const existing = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);

  if (!existing) {
    doc.catalog.set(
      PDFName.of('AcroForm'),
      context.register(context.obj({ Fields: [fieldRef], SigFlags: 3 })),
    );
    return;
  }

  const fields = existing.lookupMaybe(PDFName.of('Fields'), PDFArray);
  if (fields) {
    fields.push(fieldRef);
  } else {
    existing.set(PDFName.of('Fields'), context.obj([fieldRef]));
  }
  existing.set(PDFName.of('SigFlags'), PDFNumber.of(3));
}

/**
 * A field name nothing else in the document is using.
 *
 * Two fields sharing a name are treated as one field by a reader, which would
 * make a second timestamp appear to replace the first rather than sit beside
 * it.
 */
function uniqueFieldName(doc: PDFDocument): string {
  const acroForm = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  const fields = acroForm?.lookupMaybe(PDFName.of('Fields'), PDFArray);
  const taken = new Set<string>();

  for (let index = 0; index < (fields?.size() ?? 0); index += 1) {
    const name = fields?.lookup(index, PDFDict)?.get(PDFName.of('T'));
    if (name) taken.add(name.toString());
  }

  let candidate = 'Timestamp';
  let counter = 1;
  while (taken.has(`(${candidate})`)) {
    counter += 1;
    candidate = `Timestamp ${counter}`;
  }
  return candidate;
}

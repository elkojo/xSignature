/**
 * Opening a PDF, and finding out what may be done to it.
 *
 * An **encrypted** file cannot be re-saved without its password, so there is
 * nothing to do but say so.
 *
 * A file that **already carries a signature** is not refused, but it is not
 * ordinary either, and the difference is worth stating precisely. Rewriting
 * such a file destroys what is already there — not invalidates, *destroys*:
 * saving a two-signature document through the writer's ordinary path yields a
 * document with no signatures at all, because the dictionaries do not survive
 * the rewrite.
 *
 * Appending is different. A signature added as an incremental update leaves
 * every earlier byte untouched, so the earlier signatures still describe the
 * bytes they were computed over and still verify. That is what counter-signing
 * is, and it is the only thing this app will do to a signed document: no ink
 * on the page, no rewrite, only an appended signature.
 *
 * So this reports what the file already carries and leaves the choice to the
 * caller, which is the part that knows whether it is about to append or
 * rewrite.
 */
import {
  EncryptedPDFError,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
} from '@cantoo/pdf-lib';

import { normalizeRotation, type PageGeometry } from '../place/placement';
import { findSignatures, type FoundSignature } from '../verify/find';

export type Unreadable = 'encrypted' | 'malformed' | 'signed';

/** A PDF this app will not write on, and why. */
export class UnreadablePdf extends Error {
  constructor(
    readonly kind: Unreadable,
    message: string,
  ) {
    super(message);
    this.name = 'UnreadablePdf';
  }
}

export interface OpenPdf {
  readonly doc: PDFDocument;
  /** One entry per page, in order, ready for `placementMatrix`. */
  readonly pages: readonly PageGeometry[];
  /**
   * Signatures and timestamps the file already carried.
   *
   * Located, not judged — `verify/checkSignatures` says whether they hold.
   * Empty for the ordinary case. When it is not empty the caller must append
   * rather than rewrite, or it will destroy what is here.
   */
  readonly existing: readonly FoundSignature[];
}

/**
 * Walk the field tree looking for a signature field.
 *
 * It is a tree rather than a list: fields may nest through `Kids`, and `FT` is
 * inheritable, so a signature can be a child of a parent that carries the type.
 * `seen` guards against a `Kids` cycle — malformed files do contain them, and
 * an infinite loop here would lock the page up rather than report anything.
 */
function containsSignatureField(
  fields: PDFArray | undefined,
  doc: PDFDocument,
  inheritedType: string | undefined,
  seen: Set<string>,
): boolean {
  if (!fields) return false;

  for (let index = 0; index < fields.size(); index += 1) {
    const raw = fields.get(index);
    if (raw instanceof PDFRef) {
      const key = raw.toString();
      if (seen.has(key)) continue;
      seen.add(key);
    }

    const field = fields.lookup(index, PDFDict);
    if (!field) continue;

    const type = field.get(PDFName.of('FT'))?.toString() ?? inheritedType;
    if (type === '/Sig') return true;

    const kids = field.lookupMaybe(PDFName.of('Kids'), PDFArray);
    if (kids && containsSignatureField(kids, doc, type, seen)) return true;
  }

  return false;
}

/** True when the document already carries at least one signature field. */
export function hasSignatureField(doc: PDFDocument): boolean {
  const acroForm = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (!acroForm) return false;

  const fields = acroForm.lookupMaybe(PDFName.of('Fields'), PDFArray);
  return containsSignatureField(fields, doc, undefined, new Set());
}

/** The crop box and rotation of every page, in order. */
export function pageGeometries(doc: PDFDocument): PageGeometry[] {
  return doc.getPages().map((page) => {
    const box = page.getCropBox();
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      rotation: normalizeRotation(page.getRotation().angle),
    };
  });
}

/**
 * Open a PDF, or explain why it cannot be opened.
 *
 * `updateMetadata: false` because the library otherwise stamps its own
 * producer and modification date into every file it saves. Rewriting the
 * metadata of someone's document because they put a signature on it is not
 * ours to do, and a changed ModDate is exactly the kind of quiet edit this app
 * should not be making.
 */
export async function openPdf(bytes: Uint8Array): Promise<OpenPdf> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (cause) {
    if (cause instanceof EncryptedPDFError) {
      throw new UnreadablePdf(
        'encrypted',
        'This PDF is password-protected, so it cannot be opened or re-saved here. Remove the password and try again.',
      );
    }
    throw new UnreadablePdf(
      'malformed',
      'This file says it is a PDF but could not be read. It may be damaged or only partly downloaded.',
    );
  }

  // Loading succeeding does not mean the file is sound. The parser is lenient
  // by design — it will accept a truncated or corrupt document and only come
  // apart later, when something actually reads the page tree. Everything that
  // touches the structure therefore sits inside the guard too, so a damaged
  // file is reported as damaged instead of surfacing a library TypeError the
  // reader can make nothing of.
  try {
    if (doc.getPageCount() === 0) {
      throw new UnreadablePdf('malformed', 'This PDF has no pages in it.');
    }

    // Found in the original bytes, not in the parsed document: a signature
    // covers a byte range, and the range is only meaningful against the file
    // as it arrived.
    return { doc, pages: pageGeometries(doc), existing: findSignatures(bytes) };
  } catch (cause) {
    if (cause instanceof UnreadablePdf) throw cause;
    throw new UnreadablePdf(
      'malformed',
      'This file says it is a PDF but its contents could not be read. It may be damaged or only partly downloaded.',
    );
  }
}

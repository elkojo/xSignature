/**
 * What is already sitting on a page, and whether something new would land on it.
 *
 * A signature added to a document that already carries one is written as a
 * widget annotation beside the first, and nothing stops the two rectangles
 * overlapping. Validators care: overlapping annotations are how a document is
 * made to show one thing while being signed as another — an annotation drawn
 * over an earlier one hides what the earlier signature covered. The European
 * Commission's DSS reports it as `Elements overlap on page(s)`, at warning
 * level, beside an otherwise perfectly valid signature.
 *
 * It is a warning rather than a failure, and this app treats it the same way:
 * what it does is *show* the reader the rectangles already on the page, and say
 * so when the one being placed lands on one. A rectangle nobody can see is a
 * rectangle nobody can avoid, and that is the whole of the problem — the
 * earlier signature is drawn into the page preview like any other ink, with
 * nothing to mark it as a thing that must not be covered.
 *
 * `overlaps` below mirrors DSS's own test exactly, open intervals and all, so
 * that a file this app calls clear is one that validator calls clear too.
 */
import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  type PDFDocument,
} from '@cantoo/pdf-lib';

/** An annotation's rectangle in PDF user space, `[x1, y1, x2, y2]`. */
export type Rect = readonly [number, number, number, number];

/** What sort of thing is occupying the space, for the sake of saying so. */
export type OccupantKind =
  /** A signature field that has been signed. */
  | 'signature'
  /** A signature field left empty, waiting for somebody. */
  | 'empty-signature'
  /** Some other form field: a text box, a checkbox. */
  | 'field'
  /** A link, a note, a stamp — anything else with a rectangle. */
  | 'annotation';

export interface Occupant {
  /** Zero-based, matching `pages` on an opened document. */
  readonly page: number;
  readonly rect: Rect;
  readonly kind: OccupantKind;
  /**
   * What to call it: the signer's name, the field's name, or the annotation's
   * subtype. Null when the document gives nothing worth showing.
   */
  readonly label: string | null;
}

/**
 * Do two rectangles cover any common area?
 *
 * Deliberately the same test DSS's `AnnotationBox.isOverlap` makes, because the
 * point of asking is to agree with it:
 *
 * - The comparisons are **strict**, so rectangles that merely share an edge do
 *   not overlap. Signatures placed in adjacent table cells are the ordinary
 *   case and must not be reported.
 * - A rectangle with **no area** overlaps nothing. That is how an invisible
 *   signature is written — `[0, 0, 0, 0]` — and two invisible signatures on one
 *   page are not a finding in anybody's validator.
 *
 * Rectangles are normalized first: PDF says lower-left corner before upper-
 * right and plenty of writers disagree.
 */
export function overlaps(a: Rect, b: Rect): boolean {
  const [ax1, ay1, ax2, ay2] = normalize(a);
  const [bx1, by1, bx2, by2] = normalize(b);

  if (ax2 - ax1 === 0 || ay2 - ay1 === 0) return false;
  if (bx2 - bx1 === 0 || by2 - by1 === 0) return false;

  if (ax1 >= bx2 || bx1 >= ax2) return false;
  if (ay1 >= by2 || by1 >= ay2) return false;
  return true;
}

/** Lower-left corner first, whichever way round it was written. */
function normalize(rect: Rect): Rect {
  const [x1, y1, x2, y2] = rect;
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}

/**
 * Every annotation on `page` that occupies space, with what it is.
 *
 * Read from the parsed document rather than from the bytes, unlike `verify`:
 * nothing here is checking a signature, only asking what is in the way, and the
 * page tree is the honest answer to that. Annotations with no rectangle, or a
 * rectangle of no area, are left out — they are in nobody's way.
 */
export function occupantsOn(doc: PDFDocument, page: number): Occupant[] {
  const annots = attempt(() => doc.getPage(page).node.lookupMaybe(PDFName.of('Annots'), PDFArray));
  if (!annots) return [];

  const found: Occupant[] = [];
  for (let index = 0; index < annots.size(); index += 1) {
    // A malformed entry is skipped rather than fatal: this is advice about
    // placement, and a document with one unreadable annotation should still be
    // signable. The writer library raises on a key of the wrong type rather
    // than returning nothing, so the whole read is guarded and not only the
    // absences.
    const occupant = attempt(() => {
      const annotation = annots.lookupMaybe(index, PDFDict);
      if (!annotation) return undefined;

      const rect = rectOf(annotation);
      if (!rect) return undefined;

      const [x1, y1, x2, y2] = normalize(rect);
      if (x2 - x1 === 0 || y2 - y1 === 0) return undefined;

      return { page, rect: [x1, y1, x2, y2] as Rect, ...describe(annotation) };
    });

    if (occupant) found.push(occupant);
  }

  return found;
}

/** Whatever the read produced, or nothing if the document would not give it. */
function attempt<T>(read: () => T | undefined): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/** Every page's occupants, in page order. */
export function occupants(doc: PDFDocument): Occupant[] {
  return doc.getPages().flatMap((_, page) => occupantsOn(doc, page));
}

/** Which of `existing` the proposed rectangle would land on. */
export function overlapping(rect: Rect, existing: readonly Occupant[]): Occupant[] {
  return existing.filter((occupant) => overlaps(rect, occupant.rect));
}

function rectOf(annotation: PDFDict): Rect | null {
  const array = annotation.lookupMaybe(PDFName.of('Rect'), PDFArray);
  if (!array || array.size() !== 4) return null;

  const numbers: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const value = array.lookupMaybe(index, PDFNumber);
    if (!value) return null;
    numbers.push(value.asNumber());
  }

  return numbers.every(Number.isFinite) ? (numbers as unknown as Rect) : null;
}

/**
 * What this annotation is and what to call it.
 *
 * A signature field's best name is the signer's, out of the signature
 * dictionary it points at — which is the same `/Name` the signer typed, so it
 * is their claim rather than anything checked here. Failing that, the field's
 * own name, which is what a reader's signature panel shows.
 */
function describe(annotation: PDFDict): { kind: OccupantKind; label: string | null } {
  const fieldType = annotation.lookupMaybe(PDFName.of('FT'), PDFName)?.asString();
  const fieldName = textOf(annotation.lookupMaybe(PDFName.of('T'), PDFString, PDFHexString));

  if (fieldType === '/Sig') {
    const value = annotation.lookupMaybe(PDFName.of('V'), PDFDict);
    if (!value) return { kind: 'empty-signature', label: fieldName };

    const signer = textOf(value.lookupMaybe(PDFName.of('Name'), PDFString, PDFHexString));
    return { kind: 'signature', label: signer ?? fieldName };
  }

  if (fieldType) return { kind: 'field', label: fieldName };

  const subtype = annotation.lookupMaybe(PDFName.of('Subtype'), PDFName)?.asString();
  return { kind: 'annotation', label: subtype ? subtype.replace(/^\//, '') : null };
}

function textOf(value: PDFString | PDFHexString | undefined): string | null {
  const text = value?.decodeText().trim();
  return text ? text : null;
}

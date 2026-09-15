/**
 * Hanging a signature dictionary off a document, whatever it claims.
 *
 * A document timestamp and a certificate signature are different assertions —
 * one says these bytes existed at a time, the other says a named key signed
 * them — but the PDF bookkeeping around them is identical. Both live in a
 * dictionary with a reserved `/Contents` hole and a `/ByteRange`; both need a
 * widget annotation on a page, because a signature field is an annotation even
 * when there is nothing to see; both have to be listed on the document's form
 * with `SigFlags` set.
 *
 * All of that is here, once. What differs between the two — `/Type`,
 * `/SubFilter`, and whatever else the assertion itself needs — is the caller's
 * business and is passed in.
 *
 * The one thing this will not do is decide what the signature claims. A
 * timestamp dictionary and a signature dictionary are built by the modules that
 * know what they mean.
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
} from '@cantoo/pdf-lib';

/** Print, and locked so a reader does not offer to move or edit the field. */
const ANNOTATION_FLAGS = 132;

export interface FieldPlacement {
  /** Zero-based page the widget belongs to. */
  readonly page: number;
  /**
   * The widget's rectangle in PDF user space, or absent for an invisible one.
   *
   * A zero-sized rectangle is the conventional way to say "this field has no
   * appearance", and is what a timestamp and an invisible signature both use.
   */
  readonly rect?: readonly [number, number, number, number];
  /** The appearance stream to show in that rectangle, when there is one. */
  readonly appearance?: PDFRef;
  /**
   * Base name for the form field. A number is appended if it is taken.
   *
   * Two fields sharing a name are one field to a reader, which would make a
   * second signature appear to have replaced the first rather than sit beside
   * it.
   */
  readonly name: string;
}

/**
 * Register `dictionary` as a signature on the document, and return its ref.
 *
 * The dictionary is the signature itself — `/Type`, `/SubFilter`, the reserved
 * `/Contents` and `/ByteRange`, and anything the assertion adds. Everything
 * around it is added here.
 */
export function addSignatureField(
  doc: PDFDocument,
  dictionary: PDFDict,
  placement: FieldPlacement,
): PDFRef {
  const context = doc.context;
  const signatureRef = context.register(dictionary);

  const widget = context.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    Rect: placement.rect ? [...placement.rect] : [0, 0, 0, 0],
    F: ANNOTATION_FLAGS,
    T: PDFString.of(unusedFieldName(doc, placement.name)),
    V: signatureRef,
    P: doc.getPage(placement.page).ref,
  });

  // Set after building rather than inside the literal: an appearance is the
  // one part of a widget that a timestamp never has and a visible signature
  // always does.
  if (placement.appearance) {
    widget.set(PDFName.of('AP'), context.obj({ N: placement.appearance }));
  }

  const fieldRef = context.register(widget);

  attachToPage(doc, fieldRef, placement.page);
  attachToAcroForm(doc, fieldRef);

  return signatureRef;
}

/** The widget has to be listed on the page it belongs to. */
function attachToPage(doc: PDFDocument, fieldRef: PDFRef, page: number): void {
  const node = doc.getPage(page).node;
  const annots = node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (annots) {
    annots.push(fieldRef);
  } else {
    node.set(PDFName.of('Annots'), doc.context.obj([fieldRef]));
  }
}

/**
 * List the field on the document's form, creating one if there is none.
 *
 * `SigFlags` 3 is `SignaturesExist | AppendOnly`, which tells a reader that the
 * file carries a signature and that saving it any way other than by appending
 * would break it. It is the flag that makes a viewer warn rather than quietly
 * destroy what was added.
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

/** `base`, or `base 2`, `base 3`… — whichever nothing in the document uses. */
function unusedFieldName(doc: PDFDocument, base: string): string {
  const acroForm = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  const fields = acroForm?.lookupMaybe(PDFName.of('Fields'), PDFArray);
  const taken = new Set<string>();

  for (let index = 0; index < (fields?.size() ?? 0); index += 1) {
    const name = fields?.lookup(index, PDFDict)?.get(PDFName.of('T'));
    if (name) taken.add(name.toString());
  }

  let candidate = base;
  let counter = 1;
  while (taken.has(`(${candidate})`)) {
    counter += 1;
    candidate = `${base} ${counter}`;
  }
  return candidate;
}

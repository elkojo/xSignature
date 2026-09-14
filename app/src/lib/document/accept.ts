/**
 * What a dropped file is, and whether this app can do anything with it.
 *
 * There are two answers and no middle one: either the file becomes a PDF here,
 * on this device, in a moment — or it is turned away with a reason.
 *
 * That is a deliberate limit rather than an unfinished feature. Converting a
 * word processor's formats faithfully means either a very large converter
 * downloaded at runtime or a hand-written reader for each of them; both were
 * considered and both were judged to cost more than they are worth for an app
 * whose job is putting a signature on a page. A document that needs converting
 * is better converted by whatever wrote it, which will do it properly.
 *
 * So this has to be answerable from the file alone — its name and first bytes —
 * with no parsing, no network and nothing fetched.
 */

/** What has to happen before the file can be stamped. */
export type Route =
  /** Already a PDF. Stamp it directly. */
  | 'stamp'
  /** Text this app can set for itself. */
  | 'text'
  /** Neither. Say so and stop. */
  | 'reject';

export interface Accepted {
  route: Route;
  /** Human name of the format, for the UI. */
  format: string;
  /** Set when `route` is 'reject': why, in the app's own voice. */
  reason?: string;
}

/**
 * Formats this app sets for itself, with nothing to download.
 *
 * Plain text has no structure to preserve, and Markdown's is small enough to
 * set with the fonts every PDF reader already has. Both are laid out here in a
 * moment, on this device.
 */
const PLAIN: ReadonlyArray<readonly [ext: string, format: string]> = [
  ['txt', 'Plain text'],
  ['text', 'Plain text'],
  ['log', 'Log file'],
  ['md', 'Markdown'],
  ['markdown', 'Markdown'],
];

/**
 * Formats that look like documents and are not read here, each with its own
 * reason.
 *
 * Naming them individually is worth the lines: "save it as a PDF first" is
 * something a reader can act on, and "unsupported file" is not. The word
 * processor formats are the important entries — somebody dropping a `.docx` has
 * every reason to expect it to work, and deserves to be told plainly that it
 * does not and what to do instead.
 */
const KNOWN_REFUSALS: ReadonlyArray<readonly [ext: string, reason: string]> = [
  ['docx', 'Word documents are not read here. Open it in Word and use Save As or Print to PDF, then drop the PDF.'],
  ['doc', 'Word documents are not read here. Open it in Word and use Save As or Print to PDF, then drop the PDF.'],
  ['odt', 'OpenDocument files are not read here. Open it in LibreOffice and export it as a PDF, then drop that.'],
  ['ott', 'OpenDocument files are not read here. Open it in LibreOffice and export it as a PDF, then drop that.'],
  ['rtf', 'Rich text is not read here. Open it in a word processor and save it as a PDF first.'],
  ['pages', 'Apple Pages files are not read here. Export it as a PDF first.'],
  ['epub', 'EPUB books are not read here.'],
  ['html', 'Web pages are not read here. Most browsers can print one to a PDF.'],
  ['htm', 'Web pages are not read here. Most browsers can print one to a PDF.'],
  ['xls', 'Spreadsheets are not documents to sign.'],
  ['xlsx', 'Spreadsheets are not documents to sign.'],
  ['ods', 'Spreadsheets are not documents to sign.'],
  ['ppt', 'Slide decks are not documents to sign.'],
  ['pptx', 'Slide decks are not documents to sign.'],
  ['odp', 'Slide decks are not documents to sign.'],
];

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** True when the bytes begin with `%PDF-`, whatever the file is called. */
export function looksLikePdf(head: Uint8Array): boolean {
  const magic = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  return magic.every((byte, index) => head[index] === byte);
}

/**
 * Classify a file from its name and its first few bytes.
 *
 * The bytes win over the name: a PDF saved as `contract.txt` is still a PDF,
 * and stamping it directly is more faithful than re-typesetting a document that
 * was already laid out.
 */
export function accept(name: string, head: Uint8Array): Accepted {
  if (looksLikePdf(head)) return { route: 'stamp', format: 'PDF' };

  const ext = extensionOf(name);

  const plain = PLAIN.find(([candidate]) => candidate === ext);
  if (plain) return { route: 'text', format: plain[1] };

  const refusal = KNOWN_REFUSALS.find(([candidate]) => candidate === ext);
  if (refusal) return { route: 'reject', format: `.${ext}`, reason: refusal[1] };

  return {
    route: 'reject',
    format: ext ? `.${ext}` : 'file',
    reason:
      'This app reads PDFs, plain text and Markdown. Anything else has to be saved as a PDF first by whatever wrote it.',
  };
}

/** Bytes of the file we need to classify it. */
export const HEAD_BYTES = 8;

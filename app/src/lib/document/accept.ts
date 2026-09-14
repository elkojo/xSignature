/**
 * What a dropped file is, and what we would have to do with it.
 *
 * Deciding this early matters because the two answers cost wildly different
 * amounts: a PDF is stamped by code that is already in the bundle, while
 * anything else has to be converted first, and the converter is a large
 * download. The reader is told which one they are in for before it starts,
 * so this has to be answerable from the file alone — name and first bytes,
 * no parsing, no network, no converter loaded.
 */

/** What has to happen before the file can be stamped. */
export type Route =
  /** Already a PDF. Stamp it directly. */
  | 'stamp'
  /** A document Pandoc can read. Convert to PDF first. */
  | 'convert'
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
 * Formats Pandoc reads that a person might plausibly want to sign. Pandoc
 * reads a good deal more than this (man pages, Jira markup, CSV); listing
 * only the plausible ones keeps the failure message honest rather than
 * offering formats nobody will drop here.
 */
const CONVERTIBLE: ReadonlyArray<readonly [ext: string, format: string]> = [
  ['docx', 'Word document'],
  ['odt', 'OpenDocument text'],
  ['rtf', 'Rich text'],
  ['md', 'Markdown'],
  ['markdown', 'Markdown'],
  ['txt', 'Plain text'],
  ['html', 'HTML'],
  ['htm', 'HTML'],
  ['epub', 'EPUB'],
  ['tex', 'LaTeX'],
  ['latex', 'LaTeX'],
  ['rst', 'reStructuredText'],
  ['org', 'Org mode'],
  ['adoc', 'AsciiDoc'],
];

/**
 * Formats that look like documents and are not. Naming them individually is
 * worth it: "we cannot read .doc, it predates the format Pandoc reads" is a
 * useful thing to be told, and "unsupported file" is not.
 */
const KNOWN_REFUSALS: ReadonlyArray<readonly [ext: string, reason: string]> = [
  ['doc', 'Old-style Word files (.doc) cannot be read here. Save it as .docx or PDF first.'],
  ['pages', 'Apple Pages files cannot be read here. Export it as PDF or Word first.'],
  ['xls', 'Spreadsheets are not documents to sign.'],
  ['xlsx', 'Spreadsheets are not documents to sign.'],
  ['ppt', 'Slide decks are not documents to sign.'],
  ['pptx', 'Slide decks are not documents to sign.'],
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
 * The bytes win over the name: a PDF saved as `contract.txt` is still a PDF
 * and stamping it directly is both cheaper and more faithful than pushing it
 * through a converter that would treat it as prose.
 */
export function accept(name: string, head: Uint8Array): Accepted {
  if (looksLikePdf(head)) return { route: 'stamp', format: 'PDF' };

  const ext = extensionOf(name);

  const convertible = CONVERTIBLE.find(([candidate]) => candidate === ext);
  if (convertible) return { route: 'convert', format: convertible[1] };

  const refusal = KNOWN_REFUSALS.find(([candidate]) => candidate === ext);
  if (refusal) return { route: 'reject', format: `.${ext}`, reason: refusal[1] };

  return {
    route: 'reject',
    format: ext ? `.${ext}` : 'file',
    reason: 'This is not a document format the app can read. PDF, Word, OpenDocument, Markdown and plain text all work.',
  };
}

/** Bytes of the file we need to classify it. */
export const HEAD_BYTES = 8;

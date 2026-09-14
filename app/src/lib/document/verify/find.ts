/**
 * Finding the signatures and timestamps already in a PDF.
 *
 * The exact inverse of what the timestamp writer does, and done the same way:
 * by reading the file's bytes rather than by parsing it into objects. That is
 * not laziness. A signature covers a *byte range*, so checking one means
 * working in the bytes the signer actually saw — a parsed-and-reserialised
 * document is a different file, and would fail a check it should pass.
 *
 * Nothing here decides whether anything is valid. It locates what is claimed,
 * and `verify` says whether the claim holds.
 */
import type { ByteRange } from '../timestamp/byte-range';

export interface FoundSignature {
  readonly byteRange: ByteRange;
  /** The DER token from `/Contents`. */
  readonly token: Uint8Array;
  /** `/SubFilter`, e.g. `ETSI.RFC3161`. */
  readonly subFilter: string | null;
  /** `/Type`, which is `DocTimeStamp` for a timestamp and `Sig` for a signature. */
  readonly type: string | null;
  /**
   * Whether the range reaches the end of the file.
   *
   * When it does not, something was appended after this signature was made and
   * that something is not covered by it — which is exactly how a document is
   * made to show one thing while being signed as another.
   */
  readonly coversToEndOfFile: boolean;
}

/** Latin-1 maps every byte to one character, so offsets survive the decoding. */
const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

/** Read `/Key /Value` out of a region of dictionary text. */
function nameEntry(text: string, key: string): string | null {
  const match = new RegExp(`/${key}\\s*/([A-Za-z0-9.\\-_]+)`).exec(text);
  return match ? match[1] : null;
}

function parseHex(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  // Tokens are written into a fixed-size hole and padded with zeros; the
  // padding is not part of the DER and has to come off before parsing.
  const trimmed = clean.replace(/(00)+$/, '');
  const even = trimmed.length % 2 === 0 ? trimmed : trimmed.slice(0, -1);

  const out = new Uint8Array(even.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(even.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Every signature dictionary in the file, in the order they appear.
 *
 * A document may hold more than one: each incremental update can add another,
 * and a properly timestamped-then-signed document has two.
 */
export function findSignatures(pdf: Uint8Array): FoundSignature[] {
  const text = latin1(pdf);
  const found: FoundSignature[] = [];

  const pattern = /\/ByteRange\s*\[([^\]]*)\]/g;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const numbers = match[1].trim().split(/\s+/).map(Number);
    if (numbers.length !== 4 || numbers.some((n) => !Number.isFinite(n) || n < 0)) continue;

    const [first, firstLength, second, secondLength] = numbers as unknown as ByteRange;
    if (second < first + firstLength || second + secondLength > pdf.length) continue;

    // The hole between the two stretches is the `/Contents` hex string, angle
    // brackets included.
    if (pdf[first + firstLength] !== 0x3c || pdf[second - 1] !== 0x3e) continue;

    const token = parseHex(text.slice(first + firstLength + 1, second - 1));
    if (token.length === 0) continue;

    // The dictionary's other keys, read either side of the hex blob rather than
    // through it.
    const objectStart = Math.max(0, text.lastIndexOf(' obj', match.index));
    const dictionary =
      text.slice(objectStart, first + firstLength) +
      text.slice(second, Math.min(text.length, second + 400));

    found.push({
      byteRange: [first, firstLength, second, secondLength],
      token,
      subFilter: nameEntry(dictionary, 'SubFilter'),
      type: nameEntry(dictionary, 'Type'),
      coversToEndOfFile: isEndOfFile(pdf, second + secondLength),
    });
  }

  return found;
}

/**
 * Whether `at` is the end of the file bar trailing whitespace.
 *
 * A byte or two of newline after `%%EOF` is normal and means nothing; anything
 * more is content the signature does not cover.
 */
function isEndOfFile(pdf: Uint8Array, at: number): boolean {
  for (let index = at; index < pdf.length; index += 1) {
    const byte = pdf[index];
    if (byte !== 0x0a && byte !== 0x0d && byte !== 0x20 && byte !== 0x09) return false;
  }
  return true;
}

/** A document timestamp rather than a signature of identity. */
export function isDocumentTimestamp(signature: FoundSignature): boolean {
  return signature.type === 'DocTimeStamp' || signature.subFilter === 'ETSI.RFC3161';
}

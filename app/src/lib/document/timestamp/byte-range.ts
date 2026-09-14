/**
 * The bookkeeping that lets a PDF contain a signature over itself.
 *
 * A timestamp has to cover the whole file, including the dictionary the
 * timestamp lives in — which is impossible taken literally, so PDF defines the
 * way out. The token sits in a `/Contents` hex string, and a `/ByteRange` names
 * the two stretches of the file either side of it. Those two stretches are what
 * gets digested; the hole in the middle is the token itself.
 *
 * Everything here is plain byte arithmetic on a finished file, with no PDF
 * library involved, because the one property that matters is one a library
 * cannot help with: **the file must not move after the digest is taken**. The
 * `/ByteRange` is written at its placeholder's exact length and the token is
 * written into the space already reserved for it. If either changed the file's
 * length, every offset in it would shift and the timestamp would attest to a
 * file that no longer exists.
 */

/**
 * Room reserved for the token, in bytes of hex.
 *
 * Real tokens with a full certificate chain run to about 6 kB, so 16 kB of hex
 * holds one twice over. The spare is filled with zeros, which is what every PDF
 * signer does and what readers expect to skip.
 */
export const CONTENTS_HEX_BYTES = 32_768;

/**
 * The `/ByteRange` written before the real offsets are known.
 *
 * Spelled exactly as the writer serializes an array of those four numbers,
 * spaces and all — this string is searched for in the finished file, so a
 * character out of place here means it is never found.
 */
export const BYTE_RANGE_PLACEHOLDER = '[ 0 9999999999 9999999999 9999999999 ]';

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Find `needle` in `haystack`, searching from `from`. -1 when absent. */
export function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export interface ContentsSpan {
  /** Offset of the opening `<`. */
  readonly start: number;
  /** Offset just past the closing `>`. */
  readonly end: number;
}

/**
 * Locate the reserved `/Contents` hex string.
 *
 * Searched from the end of the file forwards, because the timestamp is appended
 * as an incremental update: if the document already contained a hex string that
 * looked similar, the one that matters is the last one.
 */
export function findContentsSpan(pdf: Uint8Array): ContentsSpan {
  const marker = ascii('/Contents <');
  let at = -1;
  for (let found = indexOfBytes(pdf, marker); found !== -1; ) {
    at = found;
    found = indexOfBytes(pdf, marker, found + 1);
  }
  if (at === -1) throw new Error('The reserved space for the timestamp was not found in the file.');

  const start = at + marker.length - 1; // the `<` itself
  const close = pdf.indexOf(0x3e, start); // `>`
  if (close === -1) throw new Error('The reserved space for the timestamp is not closed.');

  return { start, end: close + 1 };
}

export type ByteRange = readonly [number, number, number, number];

/**
 * The two stretches that get digested: everything before the token, and
 * everything after it.
 */
export function byteRangeFor(span: ContentsSpan, total: number): ByteRange {
  return [0, span.start, span.end, total - span.end];
}

/**
 * Write the real offsets over the placeholder, without changing the length.
 *
 * Padded with spaces rather than zeros: both are legal, but a reader that is
 * strict about leading zeros in numbers is more likely than one that objects to
 * whitespace inside an array.
 */
export function writeByteRange(pdf: Uint8Array, range: ByteRange): void {
  const placeholder = ascii(BYTE_RANGE_PLACEHOLDER);
  const at = indexOfBytes(pdf, placeholder);
  if (at === -1) throw new Error('The reserved space for the byte range was not found in the file.');

  const written = `[ ${range.join(' ')}`;
  if (written.length > placeholder.length - 1) {
    throw new Error('This document is too large for the space reserved for its byte range.');
  }

  const padded = written.padEnd(placeholder.length - 1, ' ') + ']';
  pdf.set(ascii(padded), at);
}

/** The bytes a timestamp is taken over: the file, minus the hole. */
export function digestedBytes(pdf: Uint8Array, range: ByteRange): Uint8Array {
  const [firstStart, firstLength, secondStart, secondLength] = range;
  const out = new Uint8Array(firstLength + secondLength);
  out.set(pdf.subarray(firstStart, firstStart + firstLength), 0);
  out.set(pdf.subarray(secondStart, secondStart + secondLength), firstLength);
  return out;
}

/**
 * Write the token into the reserved space, as hex, zero-filled to the end.
 *
 * The length is unchanged, so every offset already written into the file — the
 * cross-reference table included — stays correct, and the digest taken a moment
 * ago still describes this file.
 */
export function spliceToken(pdf: Uint8Array, span: ContentsSpan, token: Uint8Array): void {
  const room = span.end - span.start - 2; // inside the angle brackets
  const hex = toHex(token);
  if (hex.length > room) {
    throw new Error(
      `The timestamp is ${token.length} bytes, which does not fit the ${room / 2} bytes reserved for it.`,
    );
  }

  pdf.set(ascii(hex.padEnd(room, '0')), span.start + 1);
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

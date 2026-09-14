import { describe, expect, it } from 'vitest';

import {
  BYTE_RANGE_PLACEHOLDER,
  byteRangeFor,
  CONTENTS_HEX_BYTES,
  digestedBytes,
  findContentsSpan,
  indexOfBytes,
  spliceToken,
  writeByteRange,
} from './byte-range';

const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

/** A stand-in for the appended part of a signed file. */
function fileWith(contentsHexLength: number, trailer = 'trailer\n%%EOF\n'): Uint8Array {
  return enc(
    `%PDF-1.7\n1 0 obj\n<<\n/Type /DocTimeStamp\n/ByteRange ${BYTE_RANGE_PLACEHOLDER}\n` +
      `/Contents <${'0'.repeat(contentsHexLength)}>\n>>\nendobj\n${trailer}`,
  );
}

describe('indexOfBytes', () => {
  it('finds a run and reports where it starts', () => {
    expect(indexOfBytes(enc('hello world'), enc('world'))).toBe(6);
  });

  it('is -1 when absent', () => {
    expect(indexOfBytes(enc('hello'), enc('zz'))).toBe(-1);
  });

  it('searches from an offset, so later matches can be walked', () => {
    expect(indexOfBytes(enc('a b a b'), enc('a'), 1)).toBe(4);
  });

  it('does not run off the end on a needle longer than the haystack', () => {
    expect(indexOfBytes(enc('ab'), enc('abcdef'))).toBe(-1);
  });
});

describe('findContentsSpan', () => {
  it('spans the angle brackets, inclusive', () => {
    const file = fileWith(64);
    const span = findContentsSpan(file);

    expect(dec(file.subarray(span.start, span.start + 1))).toBe('<');
    expect(dec(file.subarray(span.end - 1, span.end))).toBe('>');
    expect(span.end - span.start).toBe(66); // 64 hex digits plus both brackets
  });

  it('takes the last one, because the timestamp is appended after the document', () => {
    // A document that already contained something shaped like this must not
    // capture the search: what matters is the one just written.
    const earlier = enc('1 0 obj\n<< /Contents <abcdef> >>\nendobj\n');
    const file = new Uint8Array([...earlier, ...fileWith(64)]);
    const span = findContentsSpan(file);

    expect(span.end - span.start).toBe(66);
    expect(span.start).toBeGreaterThan(earlier.length);
  });

  it('says so when there is no reserved space at all', () => {
    expect(() => findContentsSpan(enc('%PDF-1.7\ntrailer\n'))).toThrow(/not found/);
  });

  it('says so when the reserved space is not closed', () => {
    expect(() => findContentsSpan(enc('/Contents <0000'))).toThrow(/not closed/);
  });
});

describe('byteRangeFor', () => {
  it('names everything either side of the hole, and nothing of the hole', () => {
    const range = byteRangeFor({ start: 100, end: 300 }, 1000);
    expect(range).toEqual([0, 100, 300, 700]);

    const [, firstLength, , secondLength] = range;
    expect(firstLength + secondLength).toBe(1000 - 200);
  });
});

describe('writeByteRange', () => {
  it('replaces the placeholder without changing the file length by one byte', () => {
    // The whole scheme rests on this: the digest is taken after this write, so
    // if it moved anything the timestamp would describe a file that no longer
    // exists.
    const file = fileWith(64);
    const before = file.length;
    const span = findContentsSpan(file);

    writeByteRange(file, byteRangeFor(span, file.length));

    expect(file.length).toBe(before);
    expect(dec(file)).not.toContain('9999999999');
    expect(dec(file)).toMatch(/\/ByteRange \[ 0 \d+ \d+ \d+\s*\]/);
  });

  it('leaves the reserved contents exactly where they were', () => {
    const file = fileWith(64);
    const span = findContentsSpan(file);
    writeByteRange(file, byteRangeFor(span, file.length));

    expect(findContentsSpan(file)).toEqual(span);
  });

  it('says so when there is no placeholder to replace', () => {
    expect(() => writeByteRange(enc('/ByteRange [0 1 2 3]'), [0, 1, 2, 3])).toThrow(/not found/);
  });
});

describe('digestedBytes', () => {
  it('joins the two stretches and omits the hole', () => {
    const file = enc('AAAABBBBCCCC');
    // Hole is the middle four bytes.
    expect(dec(digestedBytes(file, [0, 4, 8, 4]))).toBe('AAAACCCC');
  });

  it('covers the whole file apart from the hole', () => {
    const file = fileWith(64);
    const span = findContentsSpan(file);
    const range = byteRangeFor(span, file.length);

    expect(digestedBytes(file, range).length).toBe(file.length - (span.end - span.start));
  });
});

describe('spliceToken', () => {
  const token = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

  it('writes the token as hex and fills the rest with zeros', () => {
    const file = fileWith(64);
    const span = findContentsSpan(file);
    spliceToken(file, span, token);

    const written = dec(file.subarray(span.start + 1, span.end - 1));
    expect(written.startsWith('deadbeef')).toBe(true);
    expect(written).toHaveLength(64);
    expect(written.slice(8)).toMatch(/^0+$/);
  });

  it('does not change the file length', () => {
    const file = fileWith(64);
    const before = file.length;
    spliceToken(file, findContentsSpan(file), token);
    expect(file.length).toBe(before);
  });

  it('refuses a token too large for the space rather than overrunning it', () => {
    const file = fileWith(8);
    expect(() => spliceToken(file, findContentsSpan(file), new Uint8Array(100))).toThrow(
      /does not fit/,
    );
  });

  it('reserves room for a real token with its certificate chain', () => {
    // Authorities return about 6 kB once the chain is included; the reserve is
    // deliberately more than double that.
    expect(CONTENTS_HEX_BYTES / 2).toBeGreaterThan(12_000);
  });
});

import { describe, expect, it } from 'vitest';

import { pdfDate } from '../certificate/sign/signature-dict';
import { findSignatures, parsePdfDate } from './find';

/**
 * A minimal file shaped like a signed one.
 *
 * `findSignatures` reads bytes rather than a parsed document, so a test can
 * hand it exactly the bytes it cares about: a signature dictionary with a
 * `/ByteRange` naming a hole, and a hex string sitting in that hole.
 */
function fileWith(entries: string): Uint8Array {
  const token = 'aabbccdd';
  const tail = '> >>\nendobj\n%%EOF\n';

  // Written at a fixed width and overwritten in place afterwards, exactly as
  // `byte-range.ts` does it: the offsets describe the finished bytes, so
  // nothing may change length once they are computed.
  const pad = (value: number) => String(value).padStart(10, ' ');
  const withPlaceholder =
    `%PDF-1.7\n1 0 obj\n<< /Type /Sig ${entries} ` +
    `/ByteRange [ ${pad(0)} ${pad(0)} ${pad(0)} ${pad(0)} ] /Contents <${token}${tail}`;

  const open = withPlaceholder.indexOf('/Contents <') + '/Contents <'.length - 1;
  const close = withPlaceholder.indexOf('>', open);
  const range = [0, open, close + 1, withPlaceholder.length - close - 1];

  const text = withPlaceholder.replace(
    /\/ByteRange \[ .{10} .{10} .{10} .{10} \]/,
    `/ByteRange [ ${range.map(pad).join(' ')} ]`,
  );
  return new TextEncoder().encode(text);
}

describe('findSignatures, on what a signature permits afterwards', () => {
  it('reports nothing for an ordinary approval signature', () => {
    const found = findSignatures(fileWith('/SubFilter /ETSI.CAdES.detached'));
    expect(found).toHaveLength(1);
    expect(found[0].permits).toBeNull();
  });

  it('reads the level a certifying signature allows', () => {
    // 1 forbids any later change, so a second signature cannot be added.
    for (const level of [1, 2, 3] as const) {
      const found = findSignatures(
        fileWith(
          `/Reference [ << /TransformMethod /DocMDP /TransformParams << /P ${level} /V /1.2 >> >> ]`,
        ),
      );
      expect(found[0]?.permits).toBe(level);
    }
  });

  it('assumes the specification default when a DocMDP names no level', () => {
    const found = findSignatures(
      fileWith('/Reference [ << /TransformMethod /DocMDP /TransformParams << /V /1.2 >> >> ]'),
    );
    expect(found[0]?.permits).toBe(2);
  });

  it('does not mistake some other /P for a permission level', () => {
    // /P is a page reference on a widget, and appears all over a PDF. Only one
    // that follows a DocMDP transform means this.
    const found = findSignatures(fileWith('/SubFilter /ETSI.CAdES.detached /P 3 0 R'));
    expect(found[0]?.permits).toBeNull();
  });
});

describe('parsePdfDate', () => {
  it('reads the form this app writes', () => {
    expect(parsePdfDate('D:20260915103000Z')?.toISOString()).toBe('2026-09-15T10:30:00.000Z');
  });

  it('takes an offset off to get to UTC', () => {
    // 13:49:48 in a zone two hours ahead is 11:49:48 UTC — the same moment
    // Acrobat shows as "2026/09/17 13:49:48 +02'00'".
    expect(parsePdfDate("D:20260917134948+02'00'")?.toISOString()).toBe(
      '2026-09-17T11:49:48.000Z',
    );
    expect(parsePdfDate("D:20260917094948-02'00'")?.toISOString()).toBe(
      '2026-09-17T11:49:48.000Z',
    );
  });

  it('accepts the shapes other producers write', () => {
    // The trailing apostrophe is optional in practice, the `D:` prefix is
    // dropped by some writers, and everything after the year may be missing.
    expect(parsePdfDate("D:20260917134948+0200")?.toISOString()).toBe(
      '2026-09-17T11:49:48.000Z',
    );
    expect(parsePdfDate("D:20260917134948+02'")?.toISOString()).toBe('2026-09-17T11:49:48.000Z');
    expect(parsePdfDate('20260915103000Z')?.toISOString()).toBe('2026-09-15T10:30:00.000Z');
    expect(parsePdfDate('D:2026')?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('reads a zoneless date as UTC rather than as the reader\'s own time', () => {
    // The producer's local zone is not knowable from here. Reading it in the
    // reader's zone would make the same file state a different time depending
    // on who opened it.
    expect(parsePdfDate('D:20260915103000')?.toISOString()).toBe('2026-09-15T10:30:00.000Z');
  });

  it('returns null for what is not a date at all', () => {
    expect(parsePdfDate('')).toBeNull();
    expect(parsePdfDate('not a date')).toBeNull();
    expect(parsePdfDate('D:')).toBeNull();
  });

  it('round-trips whatever the signature dictionary writes', () => {
    const when = new Date(Date.UTC(2026, 8, 17, 11, 49, 48));
    expect(parsePdfDate(pdfDate(when))?.toISOString()).toBe(when.toISOString());
  });
});

describe('findSignatures, on the time a signature claims', () => {
  it('reads /M out of the dictionary', () => {
    const found = findSignatures(fileWith('/M (D:20260915103000Z)'));
    expect(found[0].signingTime?.toISOString()).toBe('2026-09-15T10:30:00.000Z');
  });

  it('reads /M written as a hex string', () => {
    const hex = [...'D:20260915103000Z']
      .map((character) => character.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('');
    const found = findSignatures(fileWith(`/M <${hex}>`));
    expect(found[0].signingTime?.toISOString()).toBe('2026-09-15T10:30:00.000Z');
  });

  it('reports nothing when the dictionary states no time', () => {
    const found = findSignatures(fileWith('/SubFilter /ETSI.CAdES.detached'));
    expect(found[0].signingTime).toBeNull();
  });
});

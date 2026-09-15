import { describe, expect, it } from 'vitest';

import { findSignatures } from './find';

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

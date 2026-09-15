import { describe, expect, it } from 'vitest';

import { detectKeyFile, usesLegacyEncryption } from './detect';

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);

/**
 * An object identifier as DER: `06 <length> <content>`.
 *
 * Built here rather than taken from a file so that each test says which
 * algorithm it is about in the same notation the specifications use.
 */
function oid(dotted: string): number[] {
  const parts = dotted.split('.').map(Number);
  const content = [parts[0] * 40 + parts[1]];
  for (const part of parts.slice(2)) {
    const chunks: number[] = [];
    let value = part;
    do {
      chunks.unshift(value & 0x7f);
      value >>>= 7;
    } while (value > 0);
    for (let i = 0; i < chunks.length - 1; i += 1) chunks[i] |= 0x80;
    content.push(...chunks);
  }
  return [0x06, content.length, ...content];
}

/** A DER SEQUENCE wrapper, so the bytes look like the start of a keystore. */
const der = (...content: number[]) => new Uint8Array([0x30, 0x82, 0x01, 0x00, ...content]);

describe('usesLegacyEncryption', () => {
  it('sees the whole PKCS#12 password-based arc', () => {
    // 1.2.840.113549.1.12.1.1 through .6 are all RC2 or DES. PostSignum's
    // export uses .3 for its key and .6 for its certificates.
    for (const suffix of [1, 2, 3, 4, 5, 6]) {
      expect(usesLegacyEncryption(der(...oid(`1.2.840.113549.1.12.1.${suffix}`)))).toBe(true);
    }
  });

  it('sees the PKCS#5 v1.5 algorithms', () => {
    for (const suffix of [1, 3, 4, 6, 10, 11]) {
      expect(usesLegacyEncryption(der(...oid(`1.2.840.113549.1.5.${suffix}`)))).toBe(true);
    }
  });

  it('does not mistake PBES2 or PBKDF2 for their legacy siblings', () => {
    // The trap this guards: PBES2 is 1.2.840.113549.1.5.13 and PBKDF2 is .12,
    // one arc away from the PBES1 algorithms above. Matching that arc as a
    // prefix would call every current file legacy.
    expect(usesLegacyEncryption(der(...oid('1.2.840.113549.1.5.13')))).toBe(false);
    expect(usesLegacyEncryption(der(...oid('1.2.840.113549.1.5.12')))).toBe(false);
  });

  it('does not match an identifier that merely starts the same way', () => {
    // The arc is matched with its DER length byte, so a longer identifier
    // beginning with the same numbers is not a hit.
    expect(usesLegacyEncryption(der(...oid('1.2.840.113549.1.12.1.3.1')))).toBe(false);
  });
});

describe('detectKeyFile', () => {
  it('refuses a Java keystore by its magic number, and says how to convert it', () => {
    const jks = detectKeyFile('keys.jks', bytes(0xfe, 0xed, 0xfe, 0xed, 0, 0, 0, 2));

    expect(jks.kind).toBe('jks');
    expect(jks.reason).toContain('keytool -importkeystore');
  });

  it('refuses a JCEKS keystore too', () => {
    expect(detectKeyFile('keys.jks', bytes(0xce, 0xce, 0xce, 0xce, 0, 0, 0, 2)).kind).toBe('jks');
  });

  it('reads the bytes rather than the name', () => {
    // A keystore called .p12 is still a keystore, and a PEM called .p12 is
    // still PEM. The extension is only ever used to describe what was found.
    expect(detectKeyFile('cert.p12', bytes(0xfe, 0xed, 0xfe, 0xed)).kind).toBe('jks');
    expect(detectKeyFile('cert.p12', ascii('-----BEGIN CERTIFICATE-----\nAA==\n')).kind).toBe('pem');
  });

  it('finds PEM past a byte-order mark and leading blank lines', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...ascii('\n\n  -----BEGIN PRIVATE KEY-----')]);
    expect(detectKeyFile('key.pem', withBom).kind).toBe('pem');
  });

  it('separates a modern keystore from one that needs the fallback', () => {
    expect(detectKeyFile('new.p12', der(...oid('1.2.840.113549.1.5.13'))).kind).toBe('pkcs12');
    expect(detectKeyFile('old.p12', der(...oid('1.2.840.113549.1.12.1.3'))).kind).toBe('pkcs12-legacy');
  });

  it('turns away an empty file and anything unrecognised', () => {
    expect(detectKeyFile('nothing.p12', new Uint8Array()).kind).toBe('unknown');

    const junk = detectKeyFile('notes.txt', ascii('just some text'));
    expect(junk.kind).toBe('unknown');
    expect(junk.reason).toContain('.p12');
  });
});

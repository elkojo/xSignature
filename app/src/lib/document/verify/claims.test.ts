import * as asn1js from 'asn1js';
import { Certificate, Extension } from 'pkijs';
import { describe, expect, it } from 'vitest';

import { claimsOf } from './claims';

/**
 * A certificate carrying only the extensions under test.
 *
 * `claimsOf` reads extensions and nothing else, so nothing has to be signed or
 * even well-formed beyond them. That keeps these tests about the parsing, which
 * is the whole of what this module does.
 */
function certificateWith(extensions: Extension[]): Certificate {
  return new Certificate({ extensions });
}

const extension = (id: string, value: asn1js.AsnType) =>
  new Extension({
    extnID: id,
    critical: false,
    extnValue: new asn1js.OctetString({ valueHex: value.toBER(false) }).valueBlock.valueHexView
      .slice()
      .buffer as ArrayBuffer,
  });

/** `QCStatements ::= SEQUENCE OF SEQUENCE { statementId OID, info ANY OPTIONAL }`. */
const qcStatements = (...statements: Array<[string, asn1js.AsnType?]>) =>
  extension(
    '1.3.6.1.5.5.7.1.3',
    new asn1js.Sequence({
      value: statements.map(
        ([id, info]) =>
          new asn1js.Sequence({
            value: info ? [new asn1js.ObjectIdentifier({ value: id }), info] : [new asn1js.ObjectIdentifier({ value: id })],
          }),
      ),
    }),
  );

const keyUsage = (...bits: number[]) => {
  let first = 0;
  for (const bit of bits) first |= 0b1000_0000 >> bit;
  return extension('2.5.29.15', new asn1js.BitString({ valueHex: new Uint8Array([first]).buffer }));
};

const qcType = (oid: string) =>
  new asn1js.Sequence({ value: [new asn1js.ObjectIdentifier({ value: oid })] });

describe('claimsOf', () => {
  it('reports nothing at all for a certificate that declares nothing', () => {
    const claims = claimsOf(certificateWith([]));

    expect(claims.qualified).toBe(false);
    expect(claims.onQualifiedDevice).toBe(false);
    expect(claims.purpose).toBeNull();
    expect(claims.keyUsage.stated).toBe(false);
  });

  it('reads the combination this app actually produces', () => {
    // A qualified certificate whose key is *not* on a qualified device — which
    // is what a key in a file necessarily is, and what makes a signature made
    // here advanced rather than qualified. Saying that out of the certificate
    // beats asserting it in prose.
    const claims = claimsOf(
      certificateWith([
        qcStatements(
          ['0.4.0.1862.1.1'],
          ['0.4.0.1862.1.6', qcType('0.4.0.1862.1.6.1')],
        ),
        keyUsage(0, 1),
      ]),
    );

    expect(claims.qualified).toBe(true);
    expect(claims.onQualifiedDevice).toBe(false);
    expect(claims.purpose).toBe('signature');
    expect(claims.keyUsage).toEqual({ digitalSignature: true, nonRepudiation: true, stated: true });
  });

  it('reads a certificate that does claim a qualified device', () => {
    const claims = claimsOf(
      certificateWith([qcStatements(['0.4.0.1862.1.1'], ['0.4.0.1862.1.4'])]),
    );

    expect(claims.qualified).toBe(true);
    expect(claims.onQualifiedDevice).toBe(true);
  });

  it('tells a seal from a signature from a website certificate', () => {
    const purposeOf = (oid: string) =>
      claimsOf(certificateWith([qcStatements(['0.4.0.1862.1.6', qcType(oid)])])).purpose;

    expect(purposeOf('0.4.0.1862.1.6.1')).toBe('signature');
    expect(purposeOf('0.4.0.1862.1.6.2')).toBe('seal');
    expect(purposeOf('0.4.0.1862.1.6.3')).toBe('website');
  });

  it('does not find a purpose that was never declared at the top level', () => {
    // The trap this guards. QcType's identifiers live *inside* another
    // statement's information, so hunting for them anywhere in the bytes finds
    // one in a certificate that never declared a type at all.
    const claims = claimsOf(
      certificateWith([qcStatements(['0.4.0.1862.1.5', qcType('0.4.0.1862.1.6.2')])]),
    );

    expect(claims.purpose).toBeNull();
  });

  it('reads a declared transaction limit', () => {
    const limit = new asn1js.Sequence({
      value: [
        new asn1js.PrintableString({ value: 'EUR' }),
        new asn1js.Integer({ value: 15 }),
        new asn1js.Integer({ value: 3 }),
      ],
    });
    const claims = claimsOf(certificateWith([qcStatements(['0.4.0.1862.1.2', limit])]));

    expect(claims.limit).toEqual({ value: 15000, currency: 'EUR' });
  });

  it('separates "forbids signing" from "says nothing about signing"', () => {
    // Only one of the two is worth warning a reader about.
    const silent = claimsOf(certificateWith([]));
    const forbids = claimsOf(certificateWith([keyUsage(2)]));

    expect(silent.keyUsage.stated).toBe(false);
    expect(forbids.keyUsage.stated).toBe(true);
    expect(forbids.keyUsage.digitalSignature).toBe(false);
    expect(forbids.keyUsage.nonRepudiation).toBe(false);
  });

  it('reports nothing rather than throwing on a malformed extension', () => {
    const broken = new Extension({
      extnID: '1.3.6.1.5.5.7.1.3',
      critical: false,
      extnValue: new Uint8Array([0x30, 0xff, 0x01]).buffer as ArrayBuffer,
    });

    expect(() => claimsOf(certificateWith([broken]))).not.toThrow();
    expect(claimsOf(certificateWith([broken])).qualified).toBe(false);
  });
});

/** `AuthorityInfoAccessSyntax ::= SEQUENCE OF { accessMethod, accessLocation }`. */
const authorityInfoAccess = (...access: Array<[string, string, number?]>) =>
  extension(
    '1.3.6.1.5.5.7.1.1',
    new asn1js.Sequence({
      value: access.map(
        ([method, location, tag = 6]) =>
          new asn1js.Sequence({
            value: [
              new asn1js.ObjectIdentifier({ value: method }),
              new asn1js.Primitive({
                idBlock: { tagClass: 3, tagNumber: tag },
                valueHex: new TextEncoder().encode(location).buffer as ArrayBuffer,
              }),
            ],
          }),
      ),
    }),
  );

const CA_ISSUERS = '1.3.6.1.5.5.7.48.2';
const OCSP = '1.3.6.1.5.5.7.48.1';

describe('where the issuing certificate can be fetched', () => {
  it('reads the caIssuers address', () => {
    const claims = claimsOf(
      certificateWith([authorityInfoAccess([CA_ISSUERS, 'http://crt.example.cz/ca.crt'])]),
    );
    expect(claims.issuerUrl).toBe('http://crt.example.cz/ca.crt');
  });

  it('reads it out of what a real authority emits', () => {
    // The Authority Information Access extension of a PostSignum Qualified CA 4
    // certificate, byte for byte. Hand-built structures agree with the parser
    // by construction; this one was issued by somebody else, and puts the OCSP
    // responder in the same extension.
    const real =
      '306f303b06082b06010505073002862f687474703a2f2f6372742e706f73747369676e756d2e637a2f' +
      '6372742f70737175616c69666965646361342e637274303006082b0601050507300186246874747' +
      '03a2f2f6f6373702e706f73747369676e756d2e637a2f4f4353502f514341342f';
    const bytes = Uint8Array.from(real.match(/../g)!.map((b) => Number.parseInt(b, 16)));

    const claims = claimsOf(
      certificateWith([
        new Extension({
          extnID: '1.3.6.1.5.5.7.1.1',
          critical: false,
          extnValue: bytes.slice().buffer as ArrayBuffer,
        }),
      ]),
    );

    expect(claims.issuerUrl).toBe('http://crt.postsignum.cz/crt/psqualifiedca4.crt');
  });

  it('is not fooled by the OCSP responder beside it', () => {
    // Revocation is a service this app does not reach for, and its address is
    // not where a certificate is fetched from. Order must not decide it.
    const claims = claimsOf(
      certificateWith([
        authorityInfoAccess(
          [OCSP, 'http://ocsp.example.cz/'],
          [CA_ISSUERS, 'http://crt.example.cz/ca.crt'],
        ),
      ]),
    );
    expect(claims.issuerUrl).toBe('http://crt.example.cz/ca.crt');
  });

  it('reports nothing when there is only an OCSP responder', () => {
    const claims = claimsOf(certificateWith([authorityInfoAccess([OCSP, 'http://ocsp.example.cz/'])]));
    expect(claims.issuerUrl).toBeNull();
  });

  it('reports nothing when the certificate says nothing', () => {
    expect(claimsOf(certificateWith([])).issuerUrl).toBeNull();
  });

  it('ignores a location that is not an address a reader can open', () => {
    // GeneralName is a CHOICE and only the URI arm is any use here: a directory
    // name or an rfc822 address is not somewhere to go and get a file.
    const directoryName = claimsOf(
      certificateWith([authorityInfoAccess([CA_ISSUERS, 'CN=Some CA', 4])]),
    );
    expect(directoryName.issuerUrl).toBeNull();
  });

  it('refuses a scheme that is not http', () => {
    // A certificate is not a place to take a javascript: or data: URL from,
    // whatever it claims, and this value ends up rendered as a link.
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'ldap://example.cz/cn']) {
      expect(claimsOf(certificateWith([authorityInfoAccess([CA_ISSUERS, url])])).issuerUrl).toBeNull();
    }
  });

  it('survives an extension that is not what it claims to be', () => {
    const rubbish = extension('1.3.6.1.5.5.7.1.1', new asn1js.Integer({ value: 7 }));
    expect(claimsOf(certificateWith([rubbish])).issuerUrl).toBeNull();
  });
});

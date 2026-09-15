/**
 * The signature itself: a detached CMS SignedData over a stretch of bytes.
 *
 * "Detached" is the whole shape of it. The signature does not contain the
 * document — it contains a digest of the document and a statement, signed, that
 * the digest is what the signer saw. The bytes live in the PDF and the
 * signature lives in a hole inside them, which is why `encapContentInfo` here
 * carries a content *type* and no content.
 *
 * What is actually signed is not the document digest directly but the DER of
 * the **signed attributes**, one of which is that digest. That indirection is
 * what lets a signature say more than "these bytes": it also says which
 * certificate made it, and when, in a way that cannot be altered without
 * breaking the signature.
 *
 * Four attributes go in, and each earns its place:
 *
 * - **contentType** and **messageDigest** are required by CMS. Without the
 *   second, the signature would not be over the document at all.
 * - **signingTime** is the signer's own clock, and is worth exactly what that
 *   is worth: it is asserted by whoever signed and checked by nobody. A
 *   timestamp from an authority is the version of this claim that means
 *   something, which is why one can be attached afterwards.
 * - **signing-certificate-v2** binds the signature to one specific certificate
 *   by its hash. CAdES requires it, and it closes a real gap: without it, a
 *   signature verifying against "some certificate in the file" is a weaker
 *   statement than it looks.
 */
import * as asn1js from 'asn1js';
import {
  Attribute,
  Certificate,
  ContentInfo,
  EncapsulatedContentInfo,
  GeneralName,
  IssuerAndSerialNumber,
  SignedAndUnsignedAttributes,
  SignedData,
  SignerInfo,
} from 'pkijs';

/** Object identifiers, named so the structures below read as their specs. */
const ID_DATA = '1.2.840.113549.1.7.1';
const ID_SIGNED_DATA = '1.2.840.113549.1.7.2';
const CONTENT_TYPE = '1.2.840.113549.1.9.3';
const SIGNING_TIME = '1.2.840.113549.1.9.5';
const MESSAGE_DIGEST = '1.2.840.113549.1.9.4';
const SIGNING_CERTIFICATE_V2 = '1.2.840.113549.1.9.16.2.47';

export interface SigningMaterial {
  readonly certificate: Certificate;
  /** Issuer certificates to carry along, if the key file held any. */
  readonly chain: readonly Certificate[];
  readonly key: CryptoKey;
}

export interface CmsOptions {
  /** The signer's clock, as it goes into the signed attributes. */
  readonly signingTime?: Date;
}

/**
 * `SigningCertificateV2`, as RFC 5035 defines it.
 *
 * Built by hand because it is the one structure here that pkijs has no class
 * for. The hash algorithm is left out on purpose: it is `DEFAULT id-sha256` in
 * the schema, and DER requires a value equal to its default to be absent rather
 * than written out.
 */
async function signingCertificateV2(certificate: Certificate): Promise<Attribute> {
  const der = certificate.toSchema(true).toBER(false);
  const hash = await crypto.subtle.digest('SHA-256', der);

  // ESSCertIDv2 ::= SEQUENCE { certHash OCTET STRING, issuerSerial IssuerSerial }
  const essCertId = new asn1js.Sequence({
    value: [
      new asn1js.OctetString({ valueHex: hash }),
      // IssuerSerial ::= SEQUENCE { issuer GeneralNames, serialNumber INTEGER }
      new asn1js.Sequence({
        value: [
          new asn1js.Sequence({
            value: [
              new GeneralName({ type: 4, value: certificate.issuer }).toSchema(),
            ],
          }),
          certificate.serialNumber,
        ],
      }),
    ],
  });

  return new Attribute({
    type: SIGNING_CERTIFICATE_V2,
    // SigningCertificateV2 ::= SEQUENCE { certs SEQUENCE OF ESSCertIDv2 }
    values: [new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [essCertId] })] })],
  });
}

/**
 * Sign `content` and return the DER token to put in the PDF.
 *
 * `content` is the two stretches of the file either side of the hole, already
 * joined — the same bytes a verifier will reassemble and check against.
 */
export async function signDetached(
  content: Uint8Array,
  material: SigningMaterial,
  options: CmsOptions = {},
): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', content.slice().buffer as ArrayBuffer);

  const signedAttrs = new SignedAndUnsignedAttributes({
    type: 0,
    attributes: [
      new Attribute({
        type: CONTENT_TYPE,
        values: [new asn1js.ObjectIdentifier({ value: ID_DATA })],
      }),
      new Attribute({
        type: SIGNING_TIME,
        values: [new asn1js.UTCTime({ valueDate: options.signingTime ?? new Date() })],
      }),
      new Attribute({
        type: MESSAGE_DIGEST,
        values: [new asn1js.OctetString({ valueHex: digest })],
      }),
      await signingCertificateV2(material.certificate),
    ],
  });

  const signed = new SignedData({
    version: 1,
    // A content type and no content: the document is elsewhere.
    encapContentInfo: new EncapsulatedContentInfo({ eContentType: ID_DATA }),
    // The signer's certificate first, then whatever the key file carried above
    // it. A reader needs these to build a path; an empty chain means it has to
    // already hold the issuer.
    certificates: [material.certificate, ...material.chain],
    signerInfos: [
      new SignerInfo({
        version: 1,
        sid: new IssuerAndSerialNumber({
          issuer: material.certificate.issuer,
          serialNumber: material.certificate.serialNumber,
        }),
        signedAttrs,
      }),
    ],
  });

  await signed.sign(material.key, 0, 'SHA-256', content.slice().buffer as ArrayBuffer);

  const wrapped = new ContentInfo({
    contentType: ID_SIGNED_DATA,
    content: signed.toSchema(true),
  });

  return new Uint8Array(wrapped.toSchema().toBER(false));
}

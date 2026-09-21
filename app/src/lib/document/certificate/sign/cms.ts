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
 * Three attributes go in, and each earns its place:
 *
 * - **contentType** and **messageDigest** are required by CMS. Without the
 *   second, the signature would not be over the document at all.
 * - **signing-certificate-v2** binds the signature to one specific certificate
 *   by its hash. CAdES requires it, and it closes a real gap: without it, a
 *   signature verifying against "some certificate in the file" is a weaker
 *   statement than it looks.
 *
 * A fourth one is conspicuously absent, and the absence is deliberate.
 * **signing-time** — the signer's own clock — may not be here. EN 319 122-1
 * requires it for a CAdES baseline signature and EN 319 142-1 forbids it for a
 * PAdES one, because in a PDF that claim already has a home: `/M` in the
 * signature dictionary, which sits inside the byte range and is therefore
 * signed just the same. Writing it in both places is not belt and braces, it is
 * a second copy that can disagree with the first, and a validator holding the
 * PAdES baseline profile against the file drops it to the older PAdES-BES on
 * sight. So the clock is written once, by `signature-dict`, and read back from
 * there by `verify`.
 *
 * What it is worth is unchanged by where it lives: it is asserted by whoever
 * signed and checked by nobody. A timestamp from an authority is the version of
 * that claim which means something, and it is attached below as an unsigned
 * attribute.
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
const MESSAGE_DIGEST = '1.2.840.113549.1.9.4';
const SIGNING_CERTIFICATE_V2 = '1.2.840.113549.1.9.16.2.47';
/** `id-aa-signatureTimeStampToken`, where a signature's own timestamp lives. */
const SIGNATURE_TIME_STAMP = '1.2.840.113549.1.9.16.2.14';

export interface SigningMaterial {
  readonly certificate: Certificate;
  /** Issuer certificates to carry along, if the key file held any. */
  readonly chain: readonly Certificate[];
  readonly key: CryptoKey;
}

export interface CmsOptions {
  /**
   * Fetch a timestamp over the signature value, if one is wanted.
   *
   * Given the signature bytes and expected to return an RFC 3161 token over
   * them. A function rather than a URL so that nothing in this module reaches
   * the network: what goes out and where is decided by the caller, which is
   * also where the app states it before it happens.
   *
   * Note what is timestamped. Not the document — the *signature value*. The
   * signature already covers the document, so timestamping the signature dates
   * the act of signing and everything under it. It is also what makes this an
   * unsigned attribute rather than a signed one: the timestamp cannot exist
   * until the signature does, so the signature cannot cover it.
   */
  readonly timestampSignature?: (signatureValue: Uint8Array) => Promise<Uint8Array>;
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

  if (options.timestampSignature) {
    // Added after signing, which is the only order possible: the token is over
    // the signature, so it cannot be inside what the signature covers. That is
    // exactly why it is an *unsigned* attribute — and why attaching one does
    // not disturb a signature that has already been made.
    const signatureValue = new Uint8Array(
      signed.signerInfos[0].signature.valueBlock.valueHexView,
    );
    const token = await options.timestampSignature(signatureValue);

    signed.signerInfos[0].unsignedAttrs = new SignedAndUnsignedAttributes({
      type: 1,
      attributes: [
        new Attribute({
          type: SIGNATURE_TIME_STAMP,
          values: [asn1js.fromBER(token.slice().buffer as ArrayBuffer).result],
        }),
      ],
    });
  }

  const wrapped = new ContentInfo({
    contentType: ID_SIGNED_DATA,
    content: signed.toSchema(true),
  });

  return new Uint8Array(wrapped.toSchema().toBER(false));
}

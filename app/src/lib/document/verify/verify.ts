/**
 * Checking what a PDF claims about itself, and being exact about what the check
 * proves.
 *
 * A file may carry two kinds of claim, and they are not the same size.
 *
 * A **document timestamp** says these exact bytes existed at this time,
 * according to an authority that has never heard of whoever made them.
 *
 * A **certificate signature** says more: that whoever held a particular private
 * key signed these bytes. That is a claim about a person, and it is the one
 * worth being careful about.
 *
 * For either, two things are established here and a third is not.
 *
 *  1. **The document has not changed.** The bytes the claim covers are
 *     reassembled and checked against the digest inside it. If one byte moved,
 *     this fails.
 *  2. **The token is internally sound.** Its CMS signature is verified against
 *     the certificate carried inside it, so it is not something somebody
 *     assembled by hand.
 *  3. **Not** whether the signer deserves to be believed. That needs a list of
 *     trusted roots, kept current, and checked for revocation against a network
 *     this app does not use. So the signer's name is reported exactly as the
 *     token states it, and the screen says plainly that vouching for that name
 *     is a PDF reader's job.
 *
 * Point 3 matters more for a signature than for a timestamp. A timestamp whose
 * authority is unknown is still a timestamp; a signature whose signer is
 * unverified is a signature by nobody in particular. Reporting (3) as if it
 * were settled would be the dishonest version of this feature, and the
 * interesting failure — a document altered after signing — is caught by (1)
 * regardless.
 */
import * as asn1js from 'asn1js';
import { Certificate, ContentInfo, SignedData, TSTInfo } from 'pkijs';

import { checkLinks, orderChain, type ChainLink } from '../certificate/read/chain';
import { digestedBytes } from '../timestamp/byte-range';
import { claimsOf, type CertificateClaims } from './claims';
import { findSignatures, isDocumentTimestamp, type FoundSignature } from './find';

export type Verdict =
  /** Covers this file, and its own signature checks out. */
  | 'intact'
  /** The file has changed since it was signed or stamped. */
  | 'altered'
  /** The token's signature does not check out against its own certificate. */
  | 'broken'
  /** Something in the token could not be read at all. */
  | 'unreadable';

export interface CheckedSignature {
  readonly verdict: Verdict;
  /** What kind of claim this is. */
  readonly kind: 'timestamp' | 'signature';
  /**
   * The time the claim states.
   *
   * For a timestamp this is an authority's clock, which is the point of it. For
   * a signature it is the signer's own, asserted and checked by nobody.
   */
  readonly time: Date | null;
  /** The signer, exactly as the token names it. Not vouched for. */
  readonly signedBy: string | null;
  readonly policy: string | null;
  /** True when this is a document timestamp rather than a signature of identity. */
  readonly isTimestamp: boolean;
  /** What the signer typed into the signature, if anything. Not checked. */
  readonly reason: string | null;
  readonly location: string | null;
  readonly name: string | null;
  /** How many certificates the token carried, the signer's included. */
  readonly certificateCount: number;
  /**
   * What the signer's certificate declares about itself.
   *
   * Read out of the certificate, not decided here. Null when the token carried
   * no certificate to read.
   */
  readonly claims: CertificateClaims | null;
  /**
   * The certificates above the signer's, and whether each really signed the
   * next.
   *
   * Empty when the signature carries none, which is worth saying: a reader with
   * no chain has a name and no way to trace it. Arithmetic only — that these
   * certificates hang together, not that the one at the top is worth believing.
   */
  readonly chain: readonly ChainLink[];
  /**
   * A timestamp carried *inside* this signature, when it has one.
   *
   * This is what makes a signature PAdES-B-T, and it is a stronger statement
   * than the signer's own clock beside it: an authority saw the signature and
   * said when. `coversSignature` is checked here rather than assumed — a token
   * attached to a signature it does not describe would otherwise look like
   * corroboration and be none.
   */
  readonly timestamp: {
    readonly time: Date;
    readonly signedBy: string | null;
    readonly coversSignature: boolean;
  } | null;
  readonly coversToEndOfFile: boolean;
  /** How much of the file this one covers, in bytes. */
  readonly covers: number;
  /** In the app's own voice, for when the verdict is not 'intact'. */
  readonly detail: string;
}

/** Everything the file claims, checked. */
export async function checkSignatures(pdf: Uint8Array): Promise<CheckedSignature[]> {
  const found = findSignatures(pdf);
  return Promise.all(found.map((signature) => checkOne(pdf, signature)));
}

async function checkOne(pdf: Uint8Array, signature: FoundSignature): Promise<CheckedSignature> {
  const covered = digestedBytes(pdf, signature.byteRange);
  const isTimestamp = isDocumentTimestamp(signature);
  const shared = {
    isTimestamp,
    kind: (isTimestamp ? 'timestamp' : 'signature') as 'timestamp' | 'signature',
    reason: signature.reason,
    location: signature.location,
    name: signature.name,
    coversToEndOfFile: signature.coversToEndOfFile,
    covers: signature.byteRange[1] + signature.byteRange[3],
  };

  let signed: SignedData;
  try {
    const content = ContentInfo.fromBER(signature.token as unknown as ArrayBuffer);
    signed = new SignedData({ schema: content.content });
  } catch {
    return {
      ...shared,
      verdict: 'unreadable',
      time: null,
      signedBy: null,
      policy: null,
      certificateCount: 0,
      claims: null,
      chain: [],
      timestamp: null,
      detail: 'The token in this file could not be read.',
    };
  }

  // A timestamp carries its time inside a TSTInfo in the signed content; a
  // signature carries it as a signed attribute, or not at all. Neither is
  // fatal to read — the integrity check below does not depend on it.
  let time: Date | null = null;
  let policy: string | null = null;
  if (isTimestamp) {
    try {
      const eContent = signed.encapContentInfo.eContent;
      if (!eContent) throw new Error('no content');
      const info = TSTInfo.fromBER(eContent.valueBlock.valueHexView as unknown as ArrayBuffer);
      time = info.genTime;
      policy = info.policy ?? null;
    } catch {
      return {
        ...shared,
        verdict: 'unreadable',
        time: null,
        signedBy: subjectOf(signed),
        policy: null,
        certificateCount: signed.certificates?.length ?? 0,
        claims: claimsOfSigner(signed),
        chain: [],
        timestamp: null,
        detail: 'The token in this file could not be read as a timestamp.',
      };
    }
  } else {
    time = signingTimeOf(signed);
  }

  const described = {
    ...shared,
    time,
    signedBy: subjectOf(signed),
    policy,
    certificateCount: signed.certificates?.length ?? 0,
    claims: claimsOfSigner(signed),
    chain: await chainOf(signed),
    timestamp: await embeddedTimestampOf(signed),
  };

  // The library checks the digest and the signature together: a mismatch on the
  // first throws, a bad signature returns false. The two mean different things
  // to the reader, so they are reported differently.
  try {
    const ok = await signed.verify({ signer: 0, data: covered.slice().buffer as ArrayBuffer });
    return ok
      ? { ...described, verdict: 'intact', detail: '' }
      : {
          ...described,
          verdict: 'broken',
          detail: isTimestamp
            ? 'The timestamp covers this file, but its own signature does not check out against the certificate inside it.'
            : 'The signature covers this file, but does not check out against the certificate inside it.',
        };
  } catch {
    return {
      ...described,
      verdict: 'altered',
      detail: isTimestamp
        ? 'This file has changed since it was timestamped. The timestamp describes different bytes than the ones here.'
        : 'This file has changed since it was signed. The signature describes different bytes than the ones here.',
    };
  }
}

/** `id-aa-signatureTimeStampToken`. */
const SIGNATURE_TIME_STAMP = '1.2.840.113549.1.9.16.2.14';

/**
 * The timestamp a signature carries inside itself, if it carries one.
 *
 * Read out of the *unsigned* attributes, which is where it has to live: the
 * token is over the signature value, so it cannot exist until the signature
 * does, and cannot be covered by it.
 *
 * Whether it describes *this* signature is checked rather than taken on trust.
 * A token whose imprint is some other digest is not corroboration, and would
 * look exactly like corroboration if nobody compared them.
 */
async function embeddedTimestampOf(
  signed: SignedData,
): Promise<CheckedSignature['timestamp']> {
  const attributes = signed.signerInfos[0]?.unsignedAttrs?.attributes ?? [];
  const attribute = attributes.find((candidate) => candidate.type === SIGNATURE_TIME_STAMP);
  if (!attribute) return null;

  try {
    const content = new ContentInfo({ schema: attribute.values[0] });
    const tokenSigned = new SignedData({ schema: content.content });
    const eContent = tokenSigned.encapContentInfo.eContent;
    if (!eContent) return null;

    const info = TSTInfo.fromBER(eContent.valueBlock.valueHexView as unknown as ArrayBuffer);
    const imprint = new Uint8Array(info.messageImprint.hashedMessage.valueBlock.valueHexView);

    const signatureValue = new Uint8Array(signed.signerInfos[0].signature.valueBlock.valueHexView);
    const expected = new Uint8Array(
      await crypto.subtle.digest('SHA-256', signatureValue.slice().buffer as ArrayBuffer),
    );

    return {
      time: info.genTime,
      signedBy: subjectOf(tokenSigned),
      coversSignature:
        imprint.length === expected.length && imprint.every((byte, i) => byte === expected[i]),
    };
  } catch {
    return null;
  }
}

/** The signer's own clock, out of the signed attributes. */
function signingTimeOf(signed: SignedData): Date | null {
  const attributes = signed.signerInfos[0]?.signedAttrs?.attributes ?? [];
  const attribute = attributes.find((candidate) => candidate.type === '1.2.840.113549.1.9.5');
  const value = attribute?.values[0];

  if (value instanceof asn1js.UTCTime || value instanceof asn1js.GeneralizedTime) {
    return value.toDate();
  }
  return null;
}

/**
 * The chain a signature carries, checked link by link.
 *
 * The signer's certificate is the first one in a CMS structure by convention
 * and the rest are whatever the signer included, in no particular order — so
 * they are sorted into chain order before being checked, exactly as they are
 * when somebody supplies them on the signing screen.
 */
async function chainOf(signed: SignedData): Promise<ChainLink[]> {
  const certificates = (signed.certificates ?? []).filter(
    (candidate): candidate is Certificate => 'subject' in candidate,
  );
  const [leaf, ...rest] = certificates;
  if (!leaf || rest.length === 0) return [];

  return checkLinks(leaf, orderChain(leaf, rest));
}

/** What the signing certificate declares, when there is one to read. */
function claimsOfSigner(signed: SignedData): CertificateClaims | null {
  const certificate = signed.certificates?.[0];
  return certificate && 'subject' in certificate ? claimsOf(certificate) : null;
}

/** The signer's common name, or the whole subject if it has no CN. */
function subjectOf(signed: SignedData): string | null {
  const certificate = signed.certificates?.[0];
  if (!certificate || !('subject' in certificate)) return null;

  const parts = certificate.subject.typesAndValues;
  const commonName = parts.find((part) => part.type === '2.5.4.3');
  const chosen = commonName ?? parts[parts.length - 1];
  return (chosen?.value.valueBlock.value as string) ?? null;
}

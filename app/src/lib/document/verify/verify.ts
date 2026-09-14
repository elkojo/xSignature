/**
 * Checking a timestamp, and being exact about what the check proves.
 *
 * Two things are established here and a third is not.
 *
 *  1. **The document has not changed.** The digest of the bytes the timestamp
 *     covers is recomputed and compared with the imprint inside the token. If
 *     one byte moved, this fails.
 *  2. **The token is internally sound.** Its CMS signature is verified against
 *     the certificate carried inside it, so the token is not something somebody
 *     assembled by hand.
 *  3. **Not** whether the authority deserves to be believed. That needs a list
 *     of trusted roots, which would have to be shipped, kept current, and
 *     checked for revocation against a network this app does not use. So the
 *     signer's name is reported exactly as the token states it, and the screen
 *     says plainly that vouching for that name is a PDF reader's job.
 *
 * Reporting (3) as if it were settled would be the dishonest version of this
 * feature, and the interesting failure — a document altered after stamping — is
 * caught by (1) regardless.
 */
import { ContentInfo, SignedData, TSTInfo } from 'pkijs';

import { digestedBytes } from '../timestamp/byte-range';
import { findSignatures, isDocumentTimestamp, type FoundSignature } from './find';

export type Verdict =
  /** Covers this file, and its own signature checks out. */
  | 'intact'
  /** The file has changed since it was stamped. */
  | 'altered'
  /** The token's signature does not check out against its own certificate. */
  | 'broken'
  /** Something in the token could not be read at all. */
  | 'unreadable';

export interface CheckedTimestamp {
  readonly verdict: Verdict;
  /** What the token says the time was. Absent when it could not be read. */
  readonly time: Date | null;
  /** The signer, exactly as the token names it. Not vouched for. */
  readonly signedBy: string | null;
  readonly policy: string | null;
  /** True when this is a document timestamp rather than a signature of identity. */
  readonly isTimestamp: boolean;
  readonly coversToEndOfFile: boolean;
  /** How much of the file this one covers, in bytes. */
  readonly covers: number;
  /** In the app's own voice, for when the verdict is not 'intact'. */
  readonly detail: string;
}

/** Everything the file claims, checked. */
export async function checkTimestamps(pdf: Uint8Array): Promise<CheckedTimestamp[]> {
  const found = findSignatures(pdf);
  return Promise.all(found.map((signature) => checkOne(pdf, signature)));
}

async function checkOne(pdf: Uint8Array, signature: FoundSignature): Promise<CheckedTimestamp> {
  const covered = digestedBytes(pdf, signature.byteRange);
  const shared = {
    isTimestamp: isDocumentTimestamp(signature),
    coversToEndOfFile: signature.coversToEndOfFile,
    covers: signature.byteRange[1] + signature.byteRange[3],
  };

  let signed: SignedData;
  let info: TSTInfo;
  try {
    const content = ContentInfo.fromBER(signature.token as unknown as ArrayBuffer);
    signed = new SignedData({ schema: content.content });
    const eContent = signed.encapContentInfo.eContent;
    if (!eContent) throw new Error('no content');
    info = TSTInfo.fromBER(eContent.valueBlock.valueHexView as unknown as ArrayBuffer);
  } catch {
    return {
      ...shared,
      verdict: 'unreadable',
      time: null,
      signedBy: null,
      policy: null,
      detail: 'The token in this file could not be read as a timestamp.',
    };
  }

  const described = {
    ...shared,
    time: info.genTime,
    signedBy: subjectOf(signed),
    policy: info.policy ?? null,
  };

  // The library checks the imprint and the signature together: a mismatch on
  // the first throws, a bad signature returns false. The two mean different
  // things to the reader, so they are reported differently.
  try {
    const ok = await signed.verify({ signer: 0, data: covered.slice().buffer as ArrayBuffer });
    return ok
      ? { ...described, verdict: 'intact', detail: '' }
      : {
          ...described,
          verdict: 'broken',
          detail:
            'The timestamp covers this file, but its own signature does not check out against the certificate inside it.',
        };
  } catch {
    return {
      ...described,
      verdict: 'altered',
      detail:
        'This file has changed since it was timestamped. The timestamp describes different bytes than the ones here.',
    };
  }
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

/**
 * What comes out of a key file: a certificate, and the key that matches it.
 *
 * Both ways of reading a key file — the modern path through pkijs and the
 * fallback through node-forge — converge here, on one shape, in the same way
 * that typed and drawn signatures converge on one list of path commands. What
 * differs between them is only how the container was decrypted; what they
 * produce is identical, and everything downstream is written against this and
 * never against a format.
 *
 * The key is a **non-extractable** WebCrypto key, and that is the point of this
 * module. Whatever opened the container, the private key leaves here as
 * something the browser will sign with and will not hand back. The fallback
 * decrypts an old envelope and nothing more: it never signs, and the material
 * it recovers is turned into a key the platform owns before anything else sees
 * it.
 */
import type { Certificate } from 'pkijs';

/** A certificate and its key, ready to sign with. */
export interface Identity {
  /** The signing certificate. */
  readonly certificate: Certificate;
  /**
   * The rest of the chain, if the file carried it.
   *
   * Not verified and not ordered by this app — it is what the file contained.
   * A signature embeds it so that a reader has the certificates it needs to
   * build a path, which is a different thing from this app vouching for one.
   */
  readonly chain: readonly Certificate[];
  /** Non-extractable, and good for signing only. */
  readonly key: CryptoKey;
  /** The subject's common name, or the whole subject when it has none. */
  readonly subject: string;
  /** The issuer's common name, for telling two certificates apart. */
  readonly issuer: string;
  readonly validFrom: Date;
  readonly validTo: Date;
}

export type KeyFileProblem =
  /** The password did not open it. */
  | 'password'
  /** The bytes are not the format they claim to be. */
  | 'format'
  /** A certificate, but no private key to go with it. */
  | 'no-key'
  /** A key this browser cannot sign with. */
  | 'unsupported-key'
  /** A format this app does not read. */
  | 'refused';

export class UnreadableKeyFile extends Error {
  constructor(
    readonly problem: KeyFileProblem,
    message: string,
  ) {
    super(message);
    this.name = 'UnreadableKeyFile';
  }
}

/** Object identifiers, spelled out so the mapping below reads as a table. */
const RSA = '1.2.840.113549.1.1.1';
const RSA_PSS = '1.2.840.113549.1.1.10';
const EC = '1.2.840.10045.2.1';

const CURVES: Record<string, string> = {
  '1.2.840.10045.3.1.7': 'P-256',
  '1.3.132.0.34': 'P-384',
  '1.3.132.0.35': 'P-521',
};

/**
 * The import parameters a certificate's own public key implies.
 *
 * Taken from the certificate rather than guessed from the key bytes, because a
 * PKCS#8 blob does not say which signature scheme it is destined for and
 * WebCrypto insists on being told at import time.
 *
 * RSA keys are imported for PKCS#1 v1.5. That is a choice, and it is the one
 * PAdES readers universally accept; a certificate that names RSASSA-PSS is
 * imported that way instead, because such a key may not be used with v1.5.
 */
function importParameters(certificate: Certificate): RsaHashedImportParams | EcKeyImportParams {
  const algorithm = certificate.subjectPublicKeyInfo.algorithm;

  switch (algorithm.algorithmId) {
    case RSA:
      return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
    case RSA_PSS:
      return { name: 'RSA-PSS', hash: 'SHA-256' };
    case EC: {
      // The curve is a parameter of the algorithm, not part of its identifier.
      const parameters = algorithm.algorithmParams as { valueBlock?: { toString(): string } } | undefined;
      const curve = parameters ? CURVES[parameters.valueBlock?.toString() ?? ''] : undefined;
      if (!curve) {
        throw new UnreadableKeyFile(
          'unsupported-key',
          'This certificate uses an elliptic curve this browser cannot sign with. P-256, P-384 and P-521 work.',
        );
      }
      return { name: 'ECDSA', namedCurve: curve };
    }
    default:
      throw new UnreadableKeyFile(
        'unsupported-key',
        'This certificate uses a kind of key this browser cannot sign with. RSA and the common elliptic curves work.',
      );
  }
}

/**
 * Hand a decrypted PKCS#8 key to the platform, non-extractable.
 *
 * After this returns, the bytes that went in are the caller's last copy and the
 * key itself belongs to the browser.
 */
export async function importPrivateKey(
  pkcs8: Uint8Array,
  certificate: Certificate,
): Promise<CryptoKey> {
  const parameters = importParameters(certificate);

  try {
    return await crypto.subtle.importKey(
      'pkcs8',
      pkcs8.slice().buffer as ArrayBuffer,
      parameters,
      false,
      ['sign'],
    );
  } catch {
    throw new UnreadableKeyFile(
      'unsupported-key',
      'The private key in this file could not be read. It may not match the certificate beside it.',
    );
  }
}

/** A distinguished name's common name, or its last component when it has none. */
export function nameOf(name: Certificate['subject']): string {
  const parts = name.typesAndValues;
  const commonName = parts.find((part) => part.type === '2.5.4.3');
  const chosen = commonName ?? parts[parts.length - 1];
  return (chosen?.value.valueBlock.value as string) ?? '';
}

/** Assemble an identity from the pieces a reader recovered. */
export async function toIdentity(
  certificate: Certificate,
  chain: readonly Certificate[],
  pkcs8: Uint8Array,
): Promise<Identity> {
  return {
    certificate,
    chain,
    key: await importPrivateKey(pkcs8, certificate),
    subject: nameOf(certificate.subject),
    issuer: nameOf(certificate.issuer),
    validFrom: certificate.notBefore.value,
    validTo: certificate.notAfter.value,
  };
}

/**
 * Whether a certificate is usable at a given moment.
 *
 * Reported rather than enforced. A certificate that expired last week still
 * makes a mathematically sound signature, and whether that signature is worth
 * anything is a question about trust that this app does not answer — so it says
 * what the dates are and lets the reader decide.
 */
export function validityAt(identity: Identity, now: Date): 'valid' | 'expired' | 'not-yet-valid' {
  if (now < identity.validFrom) return 'not-yet-valid';
  if (now > identity.validTo) return 'expired';
  return 'valid';
}

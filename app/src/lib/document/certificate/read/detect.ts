/**
 * What kind of key file this is, and whether it can be opened here.
 *
 * Answerable from the bytes alone, with no password, because every question the
 * interface needs to ask first is a question about the container rather than
 * its contents: what format is this, will it need the fallback, and is it one
 * this app refuses? The algorithm identifiers in a PKCS#12 are in the clear —
 * only the payloads are encrypted — so all of that is readable before anyone
 * has typed anything.
 *
 * The important distinction is **legacy or not**, and it is not cosmetic.
 * WebCrypto has no RC2 and no 3DES, and never will; pkijs implements only
 * PBES2. A file encrypted the old way therefore cannot be opened by anything
 * already in this bundle, and needs a fallback fetched for the purpose.
 *
 * That is not a rare case. It is what real certificate authorities ship: a
 * PostSignum export protects its key with 3DES and its certificates with
 * RC2-40, and it is a current file from a working CA, not an antique. Treating
 * legacy as the exception would mean turning away the main use case, so it is
 * detected deliberately rather than discovered by failing.
 */

/** What the file is, and what it will take to open it. */
export type KeyFileKind =
  /** PKCS#12 encrypted the modern way. Opens with what is already bundled. */
  | 'pkcs12'
  /** PKCS#12 encrypted with RC2 or DES. Needs the fallback. */
  | 'pkcs12-legacy'
  /** PEM text: certificate and key in base64 blocks. */
  | 'pem'
  /** Java keystore. Refused, with the command that converts it. */
  | 'jks'
  /** Not a key file this app knows. */
  | 'unknown';

export interface DetectedKeyFile {
  readonly kind: KeyFileKind;
  /** Human name of the format, for the interface. */
  readonly format: string;
  /** Set when the file is refused: why, in the app's own voice. */
  readonly reason?: string;
}

/**
 * The PKCS#12 password-based encryption arc, `1.2.840.113549.1.12.1`.
 *
 * Every algorithm under it is built on RC2 or DES. Matched as a prefix rather
 * than enumerated, because the whole arc is legacy and a variant this app has
 * not seen is still one it cannot decrypt.
 */
const PKCS12_PBE_ARC = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x0c, 0x01];

/**
 * The PKCS#5 v1.5 algorithms, which are also DES and RC2.
 *
 * Enumerated rather than matched as an arc, because two of their siblings are
 * exactly what a modern file uses: `.12` is PBKDF2 and `.13` is PBES2. Matching
 * `1.2.840.113549.1.5` as a prefix would classify every current file as legacy.
 */
const PBES1_SUFFIXES = [0x01, 0x03, 0x04, 0x06, 0x0a, 0x0b];
const PBES1_ARC = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x05];

/** `FEEDFEED`, which is how a Java keystore starts. JCEKS uses `CECECECE`. */
const JKS_MAGIC = [0xfe, 0xed, 0xfe, 0xed];
const JCEKS_MAGIC = [0xce, 0xce, 0xce, 0xce];

const JKS_REASON =
  'Java keystores are not read here: the format is Sun\'s own, and it wraps keys ' +
  'in a cipher with no standard behind it. Convert it first — keytool itself ' +
  'recommends this — with:\n\n' +
  'keytool -importkeystore -srckeystore your.jks -destkeystore your.p12 -deststoretype pkcs12\n\n' +
  'then open the .p12.';

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((byte, index) => bytes[index] === byte);
}

/** Whether `needle` appears anywhere in `haystack`. */
function contains(haystack: Uint8Array, needle: readonly number[]): boolean {
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Whether the file uses encryption nothing in this bundle can undo.
 *
 * Exported because the reader routes on it, and because it is worth being able
 * to ask the question of a file without deciding anything else about it.
 */
export function usesLegacyEncryption(bytes: Uint8Array): boolean {
  // An OID in DER is `06 <length> <content>`. The length is included in the
  // search so that these bytes cannot match part of some longer identifier
  // that merely begins the same way.
  if (contains(bytes, [0x06, 0x0a, ...PKCS12_PBE_ARC])) return true;

  return PBES1_SUFFIXES.some((suffix) =>
    contains(bytes, [0x06, 0x09, ...PBES1_ARC, suffix]),
  );
}

/** Leading whitespace and a byte-order mark, which a PEM file may carry. */
function looksLikePem(bytes: Uint8Array): boolean {
  let at = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) at = 3;
  while (at < bytes.length && (bytes[at] === 0x20 || bytes[at] === 0x0a || bytes[at] === 0x0d || bytes[at] === 0x09)) {
    at += 1;
  }
  return startsWith(bytes.subarray(at), [...'-----BEGIN'].map((c) => c.charCodeAt(0)));
}

/**
 * Classify a key file from its name and its bytes.
 *
 * The bytes decide. A name is used only to describe what was found, never to
 * conclude anything — `.p12` and `.pfx` are the same format under two
 * extensions, and a file called `.key` may be any of these.
 */
export function detectKeyFile(name: string, bytes: Uint8Array): DetectedKeyFile {
  if (bytes.length === 0) {
    return { kind: 'unknown', format: 'Empty file', reason: 'This file is empty.' };
  }

  if (startsWith(bytes, JKS_MAGIC)) {
    return { kind: 'jks', format: 'Java keystore', reason: JKS_REASON };
  }
  if (startsWith(bytes, JCEKS_MAGIC)) {
    return { kind: 'jks', format: 'Java keystore (JCEKS)', reason: JKS_REASON };
  }

  if (looksLikePem(bytes)) {
    return { kind: 'pem', format: 'PEM' };
  }

  // Every PKCS#12 is a DER SEQUENCE, so it starts with 0x30. That is a weak
  // signal on its own — plenty of DER starts that way — but combined with
  // finding PKCS#12's own algorithm identifiers inside, it is enough.
  if (bytes[0] === 0x30) {
    return usesLegacyEncryption(bytes)
      ? { kind: 'pkcs12-legacy', format: 'PKCS#12, older encryption' }
      : { kind: 'pkcs12', format: 'PKCS#12' };
  }

  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return {
    kind: 'unknown',
    format: extension ? `.${extension} file` : 'Unrecognised file',
    reason:
      'This is not a key file this app recognises. A .p12, .pfx or .pem holding ' +
      'your certificate and its private key will work.',
  };
}

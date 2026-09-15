/**
 * Opening a PKCS#12 file, by either of the two routes it may need.
 *
 * **The modern route** uses pkijs, which is already in this bundle for the
 * timestamp work and costs nothing more to use here. It handles PBES2 — PBKDF2
 * with AES — which is what a current OpenSSL writes and what `Max_Svoboda.p12`
 * turned out to be.
 *
 * **The fallback route** exists because that is not what certificate
 * authorities ship. A PostSignum export wraps its key in 3DES and its
 * certificates in RC2-40, and WebCrypto implements neither cipher, so nothing
 * already here can open one. node-forge can, and is fetched at the moment a
 * file turns out to need it — never at the top of this module, or every reader
 * who only wanted a PNG would download it too.
 *
 * What the fallback does is strictly bounded: it decrypts a container. The key
 * it recovers is handed straight to WebCrypto as ordinary PKCS#8 and becomes a
 * non-extractable key there, so the old library never signs anything and never
 * holds the key in a form it could export. Every signature this app makes is
 * made by the platform.
 */
import type Forge from 'node-forge';
import { Certificate, PFX, PKCS8ShroudedKeyBag, PrivateKeyInfo } from 'pkijs';

import { toIdentity, UnreadableKeyFile, type Identity } from './identity';

/** `localKeyId`, the attribute that says which certificate a key belongs to. */
const LOCAL_KEY_ID = '1.2.840.113549.1.9.21';

/** One certificate or key recovered from the file, with its pairing tag. */
interface Recovered<T> {
  readonly value: T;
  /** Hex of `localKeyId`, or null when the bag carried none. */
  readonly localKeyId: string | null;
}

const toHex = (bytes: Uint8Array): string => {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
};

/**
 * Pair keys with their certificates, and call whatever is left the chain.
 *
 * A file may hold several identities — a signing certificate and an
 * authentication one is a common pairing, and PostSignum issues both — so the
 * pairing has to be real rather than assumed. `localKeyId` is how PKCS#12 says
 * which key goes with which certificate, and when it is present it is
 * authoritative.
 *
 * When it is absent, which older files do, there is one honest fallback: if the
 * file holds exactly one key and one certificate, they belong together. Beyond
 * that the file has not said, and guessing would mean signing with a key the
 * reader did not choose.
 */
function pair(
  certificates: readonly Recovered<Certificate>[],
  keys: readonly Recovered<Uint8Array>[],
): Array<{ certificate: Certificate; chain: Certificate[]; pkcs8: Uint8Array }> {
  const paired: Array<{ certificate: Certificate; chain: Certificate[]; pkcs8: Uint8Array }> = [];
  const claimed = new Set<Certificate>();

  for (const key of keys) {
    const match =
      key.localKeyId === null
        ? keys.length === 1 && certificates.length === 1
          ? certificates[0]
          : undefined
        : certificates.find((candidate) => candidate.localKeyId === key.localKeyId);

    if (!match) continue;
    claimed.add(match.value);
    paired.push({ certificate: match.value, chain: [], pkcs8: key.value });
  }

  // Whatever no key claimed is chain material: intermediates and roots the file
  // carried so that a reader can build a path without going looking.
  const rest = certificates.filter((entry) => !claimed.has(entry.value)).map((entry) => entry.value);
  for (const entry of paired) entry.chain = rest;

  return paired;
}

function localKeyIdOf(attributes: ReadonlyArray<{ type: string; values: unknown[] }> | undefined): string | null {
  const attribute = attributes?.find((candidate) => candidate.type === LOCAL_KEY_ID);
  const value = attribute?.values[0] as { valueBlock?: { valueHexView?: Uint8Array } } | undefined;
  const bytes = value?.valueBlock?.valueHexView;
  return bytes ? toHex(bytes) : null;
}

/** PKCS#12's key derivation takes the password's UTF-8 bytes; pkijs converts. */
const passwordBytes = (password: string): ArrayBuffer =>
  new TextEncoder().encode(password).slice().buffer;

async function readModern(bytes: Uint8Array, password: string): Promise<Identity[]> {
  const secret = passwordBytes(password);

  let pfx: PFX;
  try {
    pfx = PFX.fromBER(bytes.slice().buffer as ArrayBuffer);
  } catch {
    throw new UnreadableKeyFile('format', 'This file is not a PKCS#12 keystore, whatever it is named.');
  }

  // The integrity check is the password check: the MAC is computed from the
  // password, so a wrong one fails here rather than producing nonsense later.
  try {
    await pfx.parseInternalValues({ password: secret, checkIntegrity: true });
  } catch {
    throw new UnreadableKeyFile('password', 'That password did not open this file.');
  }

  const safe = pfx.parsedValue?.authenticatedSafe;
  if (!safe) throw new UnreadableKeyFile('format', 'This keystore has nothing in it.');

  try {
    await safe.parseInternalValues({
      safeContents: safe.safeContents.map(() => ({ password: secret })),
    });
  } catch {
    throw new UnreadableKeyFile('password', 'That password did not open the contents of this file.');
  }

  const certificates: Array<Recovered<Certificate>> = [];
  const keys: Array<Recovered<Uint8Array>> = [];

  // `parsedValue` is untyped in pkijs, and the shape below is what it actually
  // produces: each entry wraps its SafeContents in `value`.
  const contents = (safe.parsedValue?.safeContents ?? []) as Array<{
    value?: { safeBags?: Array<{ bagValue: unknown; bagAttributes?: Array<{ type: string; values: unknown[] }> }> };
  }>;

  for (const entry of contents) {
    for (const bag of entry.value?.safeBags ?? []) {
      const tag = localKeyIdOf(bag.bagAttributes);
      const value = bag.bagValue;

      if (value instanceof PKCS8ShroudedKeyBag) {
        // `parseInternalValues` is marked protected on this class alone, while
        // every other bag type exposes it. Reached through its shape rather
        // than left undone: the decryption it performs is the whole point of a
        // shrouded key bag.
        const shrouded = value as unknown as {
          parseInternalValues(parameters: { password: ArrayBuffer }): Promise<void>;
          parsedValue?: PrivateKeyInfo;
        };
        try {
          await shrouded.parseInternalValues({ password: secret });
        } catch {
          throw new UnreadableKeyFile('password', 'That password did not open the private key in this file.');
        }
        keys.push({ value: derOf(shrouded.parsedValue), localKeyId: tag });
      } else if (value instanceof PrivateKeyInfo) {
        keys.push({ value: derOf(value), localKeyId: tag });
      } else if (isCertBag(value)) {
        certificates.push({ value: value.parsedValue, localKeyId: tag });
      }
    }
  }

  return assemble(certificates, keys);
}

function derOf(info: PrivateKeyInfo | undefined): Uint8Array {
  if (!info) throw new UnreadableKeyFile('format', 'A private key in this file could not be read.');
  return new Uint8Array(info.toSchema().toBER(false));
}

function isCertBag(value: unknown): value is { parsedValue: Certificate } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'parsedValue' in value &&
    (value as { parsedValue: unknown }).parsedValue instanceof Certificate
  );
}

async function readLegacy(bytes: Uint8Array, password: string): Promise<Identity[]> {
  // Fetched here and nowhere else. A reader whose file is a current one never
  // causes this line to run, and never downloads what it imports.
  const { default: forge } = await import('node-forge');

  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);

  let store: Forge.pkcs12.Pkcs12Pfx;
  try {
    store = forge.pkcs12.pkcs12FromAsn1(
      forge.asn1.fromDer(forge.util.createBuffer(binary)),
      password,
    );
  } catch (cause) {
    // forge reports a failed MAC and a failed decryption in the same way, and
    // both mean the same thing to whoever is typing.
    const message = cause instanceof Error ? cause.message : '';
    throw /password|mac/i.test(message)
      ? new UnreadableKeyFile('password', 'That password did not open this file.')
      : new UnreadableKeyFile('format', 'This file could not be read as a PKCS#12 keystore.');
  }

  const certificates: Array<Recovered<Certificate>> = [];
  const keys: Array<Recovered<Uint8Array>> = [];

  const bagsOf = (bagType: string): Forge.pkcs12.Bag[] =>
    Object.values(store.getBags({ bagType }) as Record<string, Forge.pkcs12.Bag[] | undefined>)
      .flatMap((found) => found ?? []);

  for (const bag of bagsOf(forge.pki.oids.certBag)) {
    if (!bag.cert) continue;
    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(bag.cert)).getBytes();
    certificates.push({
      value: Certificate.fromBER(fromBinary(der).slice().buffer as ArrayBuffer),
      localKeyId: attributeHex(bag),
    });
  }

  for (const type of [forge.pki.oids.pkcs8ShroudedKeyBag, forge.pki.oids.keyBag]) {
    for (const bag of bagsOf(type)) {
      if (!bag.key) continue;
      // Re-wrapped as PKCS#8, which is the one form WebCrypto imports. This is
      // the only thing forge's copy of the key is ever used for.
      const der = forge.asn1
        .toDer(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(bag.key)))
        .getBytes();
      keys.push({ value: fromBinary(der), localKeyId: attributeHex(bag) });
    }
  }

  return assemble(certificates, keys);
}

const fromBinary = (binary: string): Uint8Array =>
  Uint8Array.from(binary, (character) => character.charCodeAt(0));

/** forge exposes `localKeyId` already hex-encoded, under `localKeyIdHex`. */
function attributeHex(bag: { attributes?: Record<string, unknown> }): string | null {
  const hex = bag.attributes?.localKeyIdHex;
  return Array.isArray(hex) ? String(hex[0]).toLowerCase() : null;
}

async function assemble(
  certificates: readonly Recovered<Certificate>[],
  keys: readonly Recovered<Uint8Array>[],
): Promise<Identity[]> {
  if (certificates.length === 0) {
    throw new UnreadableKeyFile('format', 'This keystore holds no certificate.');
  }
  if (keys.length === 0) {
    throw new UnreadableKeyFile(
      'no-key',
      'This file holds a certificate but no private key, so it cannot sign anything. ' +
        'Export it again including the key.',
    );
  }

  const pairs = pair(certificates, keys);
  if (pairs.length === 0) {
    throw new UnreadableKeyFile(
      'no-key',
      'This file holds certificates and keys but does not say which belongs to which, ' +
        'so it is not clear what it would sign with.',
    );
  }

  return Promise.all(pairs.map(({ certificate, chain, pkcs8 }) => toIdentity(certificate, chain, pkcs8)));
}

/**
 * Read every identity in a PKCS#12 file.
 *
 * `legacy` comes from `detectKeyFile`, which can tell from the bytes alone
 * which route this file needs, so the fallback is decided before a password is
 * typed rather than discovered by failing with one.
 */
export function readPkcs12(bytes: Uint8Array, password: string, legacy: boolean): Promise<Identity[]> {
  return legacy ? readLegacy(bytes, password) : readModern(bytes, password);
}

/**
 * Reading a certificate and its key out of PEM text.
 *
 * PEM is not one format but a bag of base64 blocks, and which blocks a file
 * holds decides how much work opening it is:
 *
 * - `PRIVATE KEY` is unencrypted PKCS#8, which is exactly what WebCrypto
 *   imports. Nothing has to be decrypted and nothing has to be fetched.
 * - `ENCRYPTED PRIVATE KEY`, `RSA PRIVATE KEY` and the rest need either a
 *   password undone or a structure converted, and both go through the same
 *   fallback the legacy PKCS#12 route uses. That keeps one answer to "what
 *   opens old key material" rather than two.
 *
 * Order is the convention PEM bundles are written in and the one this reads:
 * the first certificate is the signer's, and anything after it is chain. There
 * is nothing in the file that states this, which is why a PKCS#12 — where
 * `localKeyId` says so outright — is the better thing to hand this app.
 */
import type Forge from 'node-forge';
import { Certificate } from 'pkijs';

import { toIdentity, UnreadableKeyFile, type Identity } from './identity';

interface Block {
  readonly label: string;
  readonly der: Uint8Array;
  readonly text: string;
}

const BLOCK = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g;

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64.replace(/[^A-Za-z0-9+/=]/g, ''));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Every PEM block in the text, in the order they appear. */
function blocksIn(text: string): Block[] {
  const blocks: Block[] = [];
  BLOCK.lastIndex = 0;

  for (let match = BLOCK.exec(text); match !== null; match = BLOCK.exec(text)) {
    try {
      blocks.push({ label: match[1].trim(), der: decodeBase64(match[2]), text: match[0] });
    } catch {
      // A block that is not valid base64 is not a block. Skipping it rather
      // than failing means one stray paste does not cost the whole file.
    }
  }
  return blocks;
}

/**
 * Turn key material PEM into PKCS#8, fetching the fallback if it takes one.
 *
 * An unencrypted PKCS#8 block is already what is wanted and returns
 * immediately; everything else — encrypted, PKCS#1, an OpenSSL `DEK-Info`
 * header — is handed over whole.
 */
async function toPkcs8(block: Block, password: string): Promise<Uint8Array> {
  if (block.label === 'PRIVATE KEY') return block.der;

  const { default: forge } = await import('node-forge');

  let key: Forge.pki.PrivateKey | null = null;
  try {
    if (block.label === 'ENCRYPTED PRIVATE KEY') {
      // PKCS#8 with a password around it: undo that, and what is left is an
      // ordinary PrivateKeyInfo.
      const info = forge.pki.decryptPrivateKeyInfo(
        forge.asn1.fromDer(forge.util.createBuffer(binaryOf(block.der))),
        password,
      );
      key = info ? forge.pki.privateKeyFromAsn1(info) : null;
    } else {
      // PKCS#1, with or without an OpenSSL `DEK-Info` header. forge reads the
      // header itself, which is why this is given the block's text rather than
      // its bytes.
      key = forge.pki.decryptRsaPrivateKey(block.text, password);
    }
  } catch {
    key = null;
  }

  if (!key) {
    throw new UnreadableKeyFile(
      'password',
      'The private key in this file could not be opened. If it has a password, check it.',
    );
  }

  const der = forge.asn1
    .toDer(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(key)))
    .getBytes();
  return Uint8Array.from(der, (character) => character.charCodeAt(0));
}

function binaryOf(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

const KEY_LABELS = new Set([
  'PRIVATE KEY',
  'ENCRYPTED PRIVATE KEY',
  'RSA PRIVATE KEY',
  'EC PRIVATE KEY',
  'DSA PRIVATE KEY',
]);

/** Read the one identity a PEM file describes. */
export async function readPem(text: string, password: string): Promise<Identity[]> {
  const blocks = blocksIn(text);

  const certificates: Certificate[] = [];
  for (const block of blocks) {
    if (block.label !== 'CERTIFICATE') continue;
    try {
      certificates.push(Certificate.fromBER(block.der.slice().buffer as ArrayBuffer));
    } catch {
      throw new UnreadableKeyFile('format', 'A certificate in this file could not be read.');
    }
  }

  if (certificates.length === 0) {
    throw new UnreadableKeyFile(
      'format',
      'This PEM file holds no certificate. It needs the certificate as well as the key.',
    );
  }

  const keyBlock = blocks.find((block) => KEY_LABELS.has(block.label));
  if (!keyBlock) {
    throw new UnreadableKeyFile(
      'no-key',
      'This PEM file holds a certificate but no private key, so it cannot sign anything.',
    );
  }

  const pkcs8 = await toPkcs8(keyBlock, password);
  return [await toIdentity(certificates[0], certificates.slice(1), pkcs8)];
}

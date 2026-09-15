/**
 * The one way in: bytes and a password, out come the identities inside.
 *
 * Detection happens first and separately, because the interface needs to say
 * what a file is before it can sensibly ask for a password — and because a file
 * this app refuses should be refused when it is chosen, not after somebody has
 * typed a secret into a box for it.
 *
 * Nothing here keeps anything. The password is an argument, the bytes are an
 * argument, and what comes back holds a key the browser owns and will not hand
 * over. There is no cache, no module-level state and nothing written anywhere:
 * choosing the same file twice reads it twice, which is the behaviour to want.
 */
import { detectKeyFile, type DetectedKeyFile } from './detect';
import { UnreadableKeyFile, type Identity } from './identity';
import { readPem } from './pem';
import { readPkcs12 } from './pkcs12';

export { detectKeyFile, usesLegacyEncryption, type DetectedKeyFile, type KeyFileKind } from './detect';
export {
  UnreadableKeyFile,
  validityAt,
  type Identity,
  type KeyFileProblem,
} from './identity';

/**
 * Read every identity a key file holds.
 *
 * Returns a list rather than one identity because a file may hold more than
 * one — a certificate for signing and another for authentication is a common
 * pairing — and picking between them belongs to whoever owns them, not here.
 *
 * `detected` is optional only so that a caller with the bytes in hand need not
 * carry two things around; passing the one already shown to the reader is
 * better, because then what was named on screen is exactly what was opened.
 */
export async function readKeyFile(
  name: string,
  bytes: Uint8Array,
  password: string,
  detected: DetectedKeyFile = detectKeyFile(name, bytes),
): Promise<Identity[]> {
  switch (detected.kind) {
    case 'pkcs12':
      return readPkcs12(bytes, password, false);
    case 'pkcs12-legacy':
      return readPkcs12(bytes, password, true);
    case 'pem':
      return readPem(new TextDecoder().decode(bytes), password);
    default:
      throw new UnreadableKeyFile(
        'refused',
        detected.reason ?? 'This is not a key file this app can read.',
      );
  }
}

export type { Identity as CertificateIdentity };

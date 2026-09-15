/**
 * The certificates above the signer's, and whether they hang together.
 *
 * A signature is supposed to carry the certificates a reader needs to work out
 * who signed it: the one that signed the signer's, the one that signed that,
 * and so on. Plenty of key files hold only the signer's own — a PostSignum
 * export does — and a signature made from one leaves the reader with a name and
 * no way to trace it.
 *
 * So they can be supplied separately and are embedded alongside. That is not
 * this app vouching for anybody. It is including what a signature is meant to
 * include, and leaving the judgement to whatever opens the document — which is
 * where it belongs, because that is where a maintained list of trusted
 * authorities and a working revocation check actually exist.
 *
 * What is checked here is narrower and worth being precise about: that each
 * certificate really was signed by the next one up. That is arithmetic, needs
 * no trust anchor and no network, and it catches the honest mistake — the wrong
 * intermediate, a file for a different certificate — rather than an attack.
 */
import { Certificate, ContentInfo, SignedData } from 'pkijs';

/** How a file offering certificates might be shaped. */
const PEM_BLOCK = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g;

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64.replace(/[^A-Za-z0-9+/=]/g, ''));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/**
 * Every certificate in a file, whatever container it arrived in.
 *
 * Three are common and all three are accepted, because which one somebody has
 * is an accident of where they downloaded it: a PEM bundle with several blocks,
 * a single DER `.crt`, or a PKCS#7 `.p7b`, which is a signature structure
 * carrying certificates and signing nothing.
 *
 * Returns them in the order the file listed them, which is not necessarily
 * chain order — `orderChain` sorts that out.
 */
export function readCertificates(bytes: Uint8Array): Certificate[] {
  const text = new TextDecoder('latin1').decode(bytes);

  // PEM first: it is the only one that is recognisable without parsing.
  if (text.includes('-----BEGIN CERTIFICATE-----')) {
    const found: Certificate[] = [];
    PEM_BLOCK.lastIndex = 0;
    for (let match = PEM_BLOCK.exec(text); match !== null; match = PEM_BLOCK.exec(text)) {
      try {
        found.push(Certificate.fromBER(decodeBase64(match[1]).slice().buffer as ArrayBuffer));
      } catch {
        // One unreadable block does not spoil the others.
      }
    }
    return found;
  }

  const der = bytes.slice().buffer as ArrayBuffer;

  // A lone DER certificate.
  try {
    return [Certificate.fromBER(der)];
  } catch {
    // Not one; try the other shape.
  }

  // PKCS#7, which is what a `.p7b` is: a SignedData carrying certificates and
  // signing nothing at all.
  try {
    const content = ContentInfo.fromBER(der);
    const signed = new SignedData({ schema: content.content });
    return (signed.certificates ?? []).filter(
      (candidate): candidate is Certificate => 'subject' in candidate,
    );
  } catch {
    return [];
  }
}

/** Two names are the same when their encodings are. */
function sameName(a: Certificate['subject'], b: Certificate['issuer']): boolean {
  const left = new Uint8Array(a.toSchema().toBER(false));
  const right = new Uint8Array(b.toSchema().toBER(false));
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

/** A certificate that signed itself, which is where a chain stops. */
export function isSelfSigned(certificate: Certificate): boolean {
  return sameName(certificate.subject, certificate.issuer);
}

/**
 * Sort `pool` into the chain above `leaf`, issuer first.
 *
 * Walks upward: find the certificate whose subject is this one's issuer, and
 * repeat. Stops at a self-signed certificate — a root signs itself, so
 * following it further would go round for ever — and at the first link nothing
 * in the pool can supply, because a chain with a hole in it is not a chain.
 *
 * `leaf` itself is not included: it travels in the signature already.
 */
export function orderChain(leaf: Certificate, pool: readonly Certificate[]): Certificate[] {
  const ordered: Certificate[] = [];
  const remaining = [...pool];
  let current = leaf;

  while (!isSelfSigned(current)) {
    const index = remaining.findIndex((candidate) => sameName(candidate.subject, current.issuer));
    if (index === -1) break;

    const [issuer] = remaining.splice(index, 1);
    ordered.push(issuer);
    current = issuer;
  }

  return ordered;
}

export interface ChainLink {
  /** The certificate that was checked. */
  readonly subject: string;
  /** Who it says signed it. */
  readonly issuer: string;
  /** Whether that signature actually holds against the issuer's key. */
  readonly holds: boolean;
}

/**
 * Check each link: was this certificate really signed by the next one up?
 *
 * Arithmetic, not judgement. It says the chain is internally consistent — that
 * the intermediate someone supplied is the one that signed this certificate and
 * not a different file with a similar name. It says nothing about whether the
 * root deserves to be believed, which needs a maintained list of authorities
 * and a revocation check this app cannot do and does not pretend to.
 */
export async function checkLinks(
  leaf: Certificate,
  chain: readonly Certificate[],
): Promise<ChainLink[]> {
  const links: ChainLink[] = [];
  const all = [leaf, ...chain];

  for (let index = 0; index < all.length - 1; index += 1) {
    const child = all[index];
    const parent = all[index + 1];
    let holds = false;
    try {
      holds = await child.verify(parent);
    } catch {
      holds = false;
    }
    links.push({ subject: nameOf(child), issuer: nameOf(parent), holds });
  }

  return links;
}

/** A certificate's common name, or its last naming component. */
function nameOf(certificate: Certificate): string {
  const parts = certificate.subject.typesAndValues;
  const commonName = parts.find((part) => part.type === '2.5.4.3');
  const chosen = commonName ?? parts[parts.length - 1];
  return (chosen?.value.valueBlock.value as string) ?? '';
}

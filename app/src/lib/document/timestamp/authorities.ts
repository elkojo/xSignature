/**
 * Where a timestamp can actually be fetched from, in a browser.
 *
 * This list is much shorter than it looks like it should be, and the reason is
 * worth writing down because it will come up again.
 *
 * A timestamp request is a POST with the content type
 * `application/timestamp-query`, which is not one of the three types a browser
 * will send without asking permission first. So every request is preceded by a
 * CORS preflight, and an authority that does not answer that preflight cannot
 * be reached from a web page at all — no matter that the same request works
 * perfectly from a command line.
 *
 * Of the well-known authorities, none answer it. DigiCert and SSL.com are not
 * even served over TLS, so a page served over HTTPS cannot reach them on those
 * grounds alone. Sectigo, FreeTSA and the rest answer the request itself but
 * send no `Access-Control-Allow-Origin`, so the browser discards the reply
 * before this code ever sees it.
 *
 * What remains are relays that do set the header. That is a real cost and it is
 * stated plainly in the interface rather than hidden here: the request goes to
 * the relay, not to the authority whose name is on the token. What the relay
 * can see is a 32-byte digest, the time, and the address it came from. It
 * cannot see the document, and the digest cannot be turned back into one.
 */

export interface Authority {
  readonly id: string;
  readonly name: string;
  /** Who signs the token that comes back. */
  readonly signedBy: string;
  readonly url: string;
  /**
   * Whether the signing certificate chains to a root Adobe Acrobat trusts.
   *
   * It decides what the reader is told to expect when they open the result: a
   * timestamp Acrobat validates, or one it reports as being of unknown origin
   * while the bytes remain perfectly checkable by other tools.
   */
  readonly adobeTrusted: boolean;
  readonly note: string;
}

export const AUTHORITIES: readonly Authority[] = [
  {
    id: 'digicert',
    name: 'DigiCert',
    signedBy: 'DigiCert',
    url: 'https://rfc3161.ai.moda/digicert',
    adobeTrusted: true,
    note: 'Reached through the ai.moda relay. Acrobat recognises the signer.',
  },
  {
    id: 'sectigo',
    name: 'Sectigo',
    signedBy: 'Sectigo',
    url: 'https://rfc3161.ai.moda/sectigo',
    adobeTrusted: true,
    note: 'Reached through the ai.moda relay. Acrobat recognises the signer.',
  },
  {
    id: 'globalsign',
    name: 'GlobalSign',
    signedBy: 'GlobalSign',
    url: 'https://rfc3161.ai.moda/globalsign',
    adobeTrusted: true,
    note: 'Reached through the ai.moda relay. Acrobat recognises the signer.',
  },
  {
    id: 'sigstore',
    name: 'Sigstore',
    signedBy: 'sigstore.dev',
    url: 'https://timestamp.sigstore.dev/api/v1/timestamp',
    adobeTrusted: false,
    note: 'Reached directly, with no relay in between. Its root is its own, so Acrobat will not recognise the signer — the token is still verifiable with Sigstore’s published certificate.',
  },
];

export const DEFAULT_AUTHORITY_ID = 'digicert';

export function authorityById(id: string): Authority | undefined {
  return AUTHORITIES.find((authority) => authority.id === id);
}

/**
 * Accept a timestamp authority URL typed by hand, or reject it.
 *
 * Only HTTPS. A timestamp fetched over plain HTTP can be swapped in transit by
 * anyone on the path, which turns the one thing the token is supposed to
 * establish into the one thing it cannot. The browser would refuse the request
 * from an HTTPS page anyway; refusing it here means saying why.
 */
export function checkAuthorityUrl(input: string): { url: string } | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { error: 'Enter the address of a timestamp authority.' };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { error: 'That is not a web address.' };
  }

  if (parsed.protocol === 'http:') {
    return {
      error:
        'Only https addresses work. Over plain http the reply can be changed on the way back, which defeats the point of a timestamp.',
    };
  }
  if (parsed.protocol !== 'https:') return { error: 'Only https addresses work.' };

  return { url: parsed.toString() };
}

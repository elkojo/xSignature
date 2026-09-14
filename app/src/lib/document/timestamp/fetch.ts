/**
 * The one request this app makes.
 *
 * Everything else in xSignature runs without a network. This does not, and it
 * cannot: a timestamp is an assertion by somebody who is not you, so somebody
 * who is not you has to see the digest and sign it. What crosses the wire is
 * that digest — 32 bytes — and nothing else.
 *
 * The failures are worth distinguishing because they mean different things to
 * the reader. A blocked request usually means the authority does not allow
 * browsers to call it; a slow one means it is up but not answering; a refusal
 * comes from the authority itself.
 */

export class TimestampUnreachable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimestampUnreachable';
  }
}

/** How long to wait before giving up. */
export const TIMEOUT_MS = 20_000;

export async function fetchTimestamp(url: string, request: Uint8Array): Promise<Uint8Array> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/timestamp-query' },
      body: request as BufferSource,
      signal: abort.signal,
      // Nothing about who is asking. No cookies, no credentials, no referrer.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
  } catch (cause) {
    clearTimeout(timer);
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw new TimestampUnreachable(
        `The timestamp authority did not answer within ${TIMEOUT_MS / 1000} seconds. The document has not been changed.`,
      );
    }
    throw new TimestampUnreachable(
      'The timestamp authority could not be reached. It may be down, it may not allow requests from a web page, or this device may be offline. The document has not been changed.',
    );
  }
  clearTimeout(timer);

  if (!response.ok) {
    throw new TimestampUnreachable(
      `The timestamp authority answered with ${response.status}. The document has not been changed.`,
    );
  }

  return new Uint8Array(await response.arrayBuffer());
}

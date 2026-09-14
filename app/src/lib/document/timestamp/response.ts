/**
 * Reading what the timestamp authority sent back.
 *
 * Two things have to be true before the reply is worth embedding: the authority
 * says it granted the request, and the token it returned is a timestamp over
 * *our* digest with *our* nonce. The second is the one that matters — a reply
 * that verifies fine but attests to a different document is worse than no reply
 * at all, so the imprint is compared byte for byte rather than assumed.
 *
 * Nothing here verifies the authority's signature or its certificate chain.
 * That is deliberate: it would need a trust store this app has no business
 * shipping or maintaining, and the useful check happens later in whatever the
 * reader opens the PDF with. What is claimed on screen is exactly what is
 * checked here and no more.
 */
import { ContentInfo, SignedData, TimeStampResp, TSTInfo } from 'pkijs';

/** The RFC 3161 status values that mean the request was not granted. */
const STATUS_TEXT: Record<number, string> = {
  0: 'granted',
  1: 'granted, with changes',
  2: 'rejected',
  3: 'waiting',
  4: 'revocation warning',
  5: 'revocation notified',
};

export class TimestampRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimestampRefused';
  }
}

export interface Timestamp {
  /** The DER token, exactly as it goes into the PDF. */
  readonly token: Uint8Array;
  /** The time the authority says it was. */
  readonly time: Date;
  /** The authority's policy OID, which identifies what it is promising. */
  readonly policy: string;
  /** How far out the authority admits it may be, in seconds, when it says. */
  readonly accuracySeconds: number | null;
}

/**
 * Parse a reply and check it answers the request that was sent.
 *
 * `digest` and `nonce` are what was asked for; both are compared against what
 * came back.
 */
export function readTimestampResponse(
  der: Uint8Array,
  digest: Uint8Array,
  nonce: Uint8Array,
): Timestamp {
  let response: TimeStampResp;
  try {
    response = TimeStampResp.fromBER(der as unknown as ArrayBuffer);
  } catch {
    throw new TimestampRefused('The timestamp authority sent something that is not an RFC 3161 reply.');
  }

  const status = response.status.status;
  if (status !== 0 && status !== 1) {
    const text = STATUS_TEXT[status] ?? `status ${status}`;
    const said = response.status.statusStrings?.map((s) => s.getValue()).join('; ');
    throw new TimestampRefused(
      `The timestamp authority refused the request (${text}${said ? `: ${said}` : ''}).`,
    );
  }

  if (!response.timeStampToken) {
    throw new TimestampRefused('The timestamp authority granted the request but sent no token.');
  }

  const token = new Uint8Array(response.timeStampToken.toSchema().toBER(false));
  const info = readTstInfo(response.timeStampToken);

  const imprint = new Uint8Array(info.messageImprint.hashedMessage.valueBlock.valueHexView);
  if (!sameBytes(imprint, digest)) {
    throw new TimestampRefused(
      'The timestamp came back for a different document than the one that was sent. It has not been used.',
    );
  }

  const echoed = info.nonce ? new Uint8Array(info.nonce.valueBlock.valueHexView) : null;
  if (!echoed || !sameBytes(trimLeadingZeros(echoed), trimLeadingZeros(nonce))) {
    throw new TimestampRefused(
      'The timestamp did not echo the number sent with the request, so it may be a replay of an older one.',
    );
  }

  return {
    token,
    time: info.genTime,
    policy: info.policy ?? 'unstated',
    accuracySeconds: accuracyOf(info),
  };
}

function readTstInfo(content: ContentInfo): TSTInfo {
  const signed = new SignedData({ schema: content.content });
  const eContent = signed.encapContentInfo.eContent;
  if (!eContent) throw new TimestampRefused('The timestamp token carried no timestamp in it.');
  return TSTInfo.fromBER(eContent.valueBlock.valueHexView as unknown as ArrayBuffer);
}

function accuracyOf(info: TSTInfo): number | null {
  const accuracy = info.accuracy;
  if (!accuracy) return null;
  return (accuracy.seconds ?? 0) + (accuracy.millis ?? 0) / 1e3 + (accuracy.micros ?? 0) / 1e6;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/**
 * Drop leading zero bytes before comparing nonces.
 *
 * A nonce is an ASN.1 INTEGER, and the encoding is free to add a leading zero
 * to keep the value positive or to drop one that is not needed. Comparing the
 * raw bytes therefore fails on perfectly good replies, which looks exactly like
 * a replay attack and is not one.
 */
function trimLeadingZeros(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
  return bytes.subarray(start);
}

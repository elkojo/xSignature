/**
 * What a certificate says about itself.
 *
 * Every other check in this module is the app deciding something. This is the
 * opposite: it reads statements the certificate authority put *inside* the
 * certificate and reports them as claims, without endorsing any of them. The
 * distinction is the whole point, and the interface has to keep it — "this
 * certificate declares itself qualified" is a fact about the file; "this
 * signature is qualified" is a judgement, and not one this app is entitled to.
 *
 * It is worth reading all the same, because one particular combination settles
 * a question this app has so far only asserted. A certificate may declare
 * itself qualified under eIDAS (`QcCompliance`) and separately declare that its
 * private key lives on a qualified signature creation device (`QcSSCD`). A
 * *qualified electronic signature* needs both. A key in a file a browser can
 * read is by definition not on such a device — so a certificate with
 * QcCompliance and no QcSSCD is exactly the case this app handles, and saying
 * so out of the certificate's own extension is better evidence than repeating
 * the claim in prose.
 *
 * Nothing here needs a network, a trust store, or anything that has to be kept
 * up to date. It is parsing.
 */
import * as asn1js from 'asn1js';
import type { Certificate } from 'pkijs';

/** ETSI's qualified-certificate statements, `0.4.0.1862.1.x`. */
const QC_COMPLIANCE = '0.4.0.1862.1.1';
const QC_LIMIT_VALUE = '0.4.0.1862.1.2';
const QC_RETENTION = '0.4.0.1862.1.3';
const QC_SSCD = '0.4.0.1862.1.4';
const QC_TYPE = '0.4.0.1862.1.6';

const QC_TYPES: Record<string, Purpose> = {
  '0.4.0.1862.1.6.1': 'signature',
  '0.4.0.1862.1.6.2': 'seal',
  '0.4.0.1862.1.6.3': 'website',
};

const QC_STATEMENTS_EXTENSION = '1.3.6.1.5.5.7.1.3';
const KEY_USAGE_EXTENSION = '2.5.29.15';

/** What the certificate is for, when it says. */
export type Purpose =
  /** A natural person's electronic signature. */
  | 'signature'
  /** A legal person's electronic seal. */
  | 'seal'
  /** Website authentication, which is not for signing documents at all. */
  | 'website';

export interface CertificateClaims {
  /** It declares itself a qualified certificate under eIDAS. */
  readonly qualified: boolean;
  /**
   * It declares that the private key lives on a qualified device.
   *
   * Never true for a key this app can use: a file a browser can read is one
   * that can be copied, which is the opposite of what the declaration means.
   */
  readonly onQualifiedDevice: boolean;
  readonly purpose: Purpose | null;
  /** Years the authority undertakes to keep its records, when it says. */
  readonly retentionYears: number | null;
  /** A transaction value limit, when one is declared. */
  readonly limit: { readonly value: number; readonly currency: string } | null;
  /** Whether the key may be used to sign at all, per the key usage extension. */
  readonly keyUsage: {
    readonly digitalSignature: boolean;
    /** Also called contentCommitment: signing as an act of agreement. */
    readonly nonRepudiation: boolean;
    /** False when the extension is absent, which places no restriction. */
    readonly stated: boolean;
  };
}

/** Everything one certificate declares, or nothing when it declares nothing. */
export function claimsOf(certificate: Certificate): CertificateClaims {
  const statements = qcStatements(certificate);

  return {
    qualified: statements.has(QC_COMPLIANCE),
    onQualifiedDevice: statements.has(QC_SSCD),
    purpose: purposeFrom(statements.get(QC_TYPE)),
    retentionYears: integerFrom(statements.get(QC_RETENTION)),
    limit: limitFrom(statements.get(QC_LIMIT_VALUE)),
    keyUsage: keyUsageOf(certificate),
  };
}

/**
 * The statements, by identifier, each with whatever it carried alongside.
 *
 * `QCStatements ::= SEQUENCE OF QCStatement`, and each `QCStatement` is a
 * `SEQUENCE { statementId OID, statementInfo ANY OPTIONAL }`. Parsed as that
 * rather than by hunting for identifiers anywhere in the bytes: the type
 * identifiers live *inside* another statement's information, so a blind search
 * would report a purpose that was never declared at the top level.
 */
function qcStatements(certificate: Certificate): Map<string, asn1js.AsnType | undefined> {
  const found = new Map<string, asn1js.AsnType | undefined>();

  const extension = certificate.extensions?.find((e) => e.extnID === QC_STATEMENTS_EXTENSION);
  if (!extension) return found;

  try {
    const parsed = asn1js.fromBER(
      extension.extnValue.valueBlock.valueHexView.slice().buffer as ArrayBuffer,
    );
    const sequence = parsed.result as asn1js.Sequence;

    for (const statement of sequence.valueBlock.value) {
      const parts = (statement as asn1js.Sequence).valueBlock?.value ?? [];
      const id = parts[0];
      if (id instanceof asn1js.ObjectIdentifier) {
        found.set(id.valueBlock.toString(), parts[1]);
      }
    }
  } catch {
    // A malformed extension is not a claim. Reporting nothing is right.
  }

  return found;
}

function purposeFrom(info: asn1js.AsnType | undefined): Purpose | null {
  const values = (info as asn1js.Sequence | undefined)?.valueBlock?.value ?? [];
  for (const value of values) {
    if (value instanceof asn1js.ObjectIdentifier) {
      const purpose = QC_TYPES[value.valueBlock.toString()];
      if (purpose) return purpose;
    }
  }
  return null;
}

function integerFrom(info: asn1js.AsnType | undefined): number | null {
  if (info instanceof asn1js.Integer) {
    const value = Number(info.valueBlock.toString());
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

/** `QcEuLimitValue ::= SEQUENCE { currency, amount INTEGER, exponent INTEGER }`. */
function limitFrom(info: asn1js.AsnType | undefined): CertificateClaims['limit'] {
  const parts = (info as asn1js.Sequence | undefined)?.valueBlock?.value ?? [];
  if (parts.length < 3) return null;

  const currency = parts[0];
  const amount = Number((parts[1] as asn1js.Integer)?.valueBlock?.toString());
  const exponent = Number((parts[2] as asn1js.Integer)?.valueBlock?.toString());
  if (!Number.isFinite(amount) || !Number.isFinite(exponent)) return null;

  const name =
    currency instanceof asn1js.PrintableString
      ? (currency.valueBlock.value as string)
      : String((currency as asn1js.Integer)?.valueBlock?.toString() ?? '');

  return { value: amount * 10 ** exponent, currency: name };
}

/**
 * The key usage bits that decide whether this key may sign.
 *
 * The extension is a BIT STRING, most significant bit first: bit 0 is
 * `digitalSignature` and bit 1 is `nonRepudiation`. Absent, it places no
 * restriction at all, which is reported as `stated: false` rather than as two
 * falses — "this certificate forbids signing" and "this certificate says
 * nothing about signing" are different, and only one is worth warning about.
 */
function keyUsageOf(certificate: Certificate): CertificateClaims['keyUsage'] {
  const extension = certificate.extensions?.find((e) => e.extnID === KEY_USAGE_EXTENSION);
  if (!extension) return { digitalSignature: false, nonRepudiation: false, stated: false };

  try {
    const parsed = asn1js.fromBER(
      extension.extnValue.valueBlock.valueHexView.slice().buffer as ArrayBuffer,
    );
    const bits = new Uint8Array((parsed.result as asn1js.BitString).valueBlock.valueHexView);
    const first = bits[0] ?? 0;

    return {
      digitalSignature: (first & 0b1000_0000) !== 0,
      nonRepudiation: (first & 0b0100_0000) !== 0,
      stated: true,
    };
  } catch {
    return { digitalSignature: false, nonRepudiation: false, stated: false };
  }
}

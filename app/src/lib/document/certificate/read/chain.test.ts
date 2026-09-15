import { Certificate } from 'pkijs';
import { beforeAll, describe, expect, it } from 'vitest';

import { checkLinks, isSelfSigned, orderChain, readCertificates } from './chain';
import { makeChain, type GeneratedChain } from './fixtures/make-keys';

let made: GeneratedChain;
let leaf: Certificate;

beforeAll(async () => {
  made = await makeChain();
  leaf = Certificate.fromBER(made.leaf.slice().buffer as ArrayBuffer);
}, 60_000);

const nameOf = (c: Certificate) =>
  c.subject.typesAndValues.find((p) => p.type === '2.5.4.3')?.value.valueBlock.value as string;

describe('readCertificates', () => {
  it('reads a PEM bundle holding several', () => {
    const bytes = new TextEncoder().encode(made.bundlePem);
    expect(readCertificates(bytes).map(nameOf)).toEqual(['Test Issuing CA', 'Test Root CA']);
  });

  it('reads a single DER certificate', () => {
    expect(readCertificates(made.rootDer).map(nameOf)).toEqual(['Test Root CA']);
  });

  it('survives a bundle with something unreadable in the middle', () => {
    // One bad block should cost that block, not the file.
    const broken = made.bundlePem.replace(
      /-----BEGIN CERTIFICATE-----\n/,
      '-----BEGIN CERTIFICATE-----\n!!!!\n-----END CERTIFICATE-----\n-----BEGIN CERTIFICATE-----\n',
    );
    expect(readCertificates(new TextEncoder().encode(broken)).length).toBeGreaterThanOrEqual(1);
  });

  it('gives back nothing for a file that holds no certificate', () => {
    expect(readCertificates(new TextEncoder().encode('just some text'))).toEqual([]);
    expect(readCertificates(new Uint8Array([1, 2, 3, 4]))).toEqual([]);
  });
});

describe('orderChain', () => {
  it('sorts a jumbled pool into issuer order', () => {
    // The order certificates arrive in is an accident of the file.
    const pool = readCertificates(new TextEncoder().encode(made.bundlePem)).reverse();
    expect(orderChain(leaf, pool).map(nameOf)).toEqual(['Test Issuing CA', 'Test Root CA']);
  });

  it('leaves the signer out — it travels in the signature already', () => {
    const pool = readCertificates(new TextEncoder().encode(made.bundlePem));
    expect(orderChain(leaf, pool).map(nameOf)).not.toContain('Jiří Novák');
  });

  it('stops at a hole rather than skipping it', () => {
    // Given only the root, the link from the leaf cannot be made, so nothing
    // is claimed. A chain with a gap is not a chain.
    const rootOnly = readCertificates(made.rootDer);
    expect(orderChain(leaf, rootOnly)).toEqual([]);
  });

  it('ignores certificates that belong to some other chain', () => {
    const pool = [
      ...readCertificates(new TextEncoder().encode(made.bundlePem)),
      leaf,
    ];
    expect(orderChain(leaf, pool).map(nameOf)).toEqual(['Test Issuing CA', 'Test Root CA']);
  });

  it('does not loop for ever on a self-signed root', () => {
    const root = readCertificates(made.rootDer)[0];
    expect(isSelfSigned(root)).toBe(true);
    expect(orderChain(root, [root])).toEqual([]);
  });
});

describe('checkLinks', () => {
  it('confirms each certificate really was signed by the next', async () => {
    const chain = orderChain(leaf, readCertificates(new TextEncoder().encode(made.bundlePem)));
    const links = await checkLinks(leaf, chain);

    expect(links).toHaveLength(2);
    expect(links.every((link) => link.holds)).toBe(true);
    expect(links[0]).toMatchObject({ subject: 'Jiří Novák', issuer: 'Test Issuing CA' });
    expect(links[1]).toMatchObject({ subject: 'Test Issuing CA', issuer: 'Test Root CA' });
  });

  it('catches an intermediate from somewhere else', async () => {
    // The honest mistake this is for: the right-looking file from the wrong
    // authority. Names can match while signatures do not.
    const other = await makeChain();
    const wrongIssuer = readCertificates(other.intermediateDer);
    const links = await checkLinks(leaf, wrongIssuer);

    expect(links).toHaveLength(1);
    expect(links[0].holds).toBe(false);
  }, 60_000);

  it('says nothing at all when there is no chain to check', async () => {
    expect(await checkLinks(leaf, [])).toEqual([]);
  });
});

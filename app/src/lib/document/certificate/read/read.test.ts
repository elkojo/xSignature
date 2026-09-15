import { beforeAll, describe, expect, it } from 'vitest';

import { detectKeyFile } from './detect';
import { makeKeyFiles, type KeyFileSet } from './fixtures/make-keys';
import { UnreadableKeyFile, validityAt } from './identity';
import { readKeyFile } from './read';

let keys: KeyFileSet;
let expired: KeyFileSet;

beforeAll(async () => {
  // One key generated for the whole file: the certificate is what is being
  // read, and generating a fresh 2048-bit key per test would dominate the run.
  keys = await makeKeyFiles({ commonName: 'Max Svoboda' });
  expired = await makeKeyFiles({
    commonName: 'Lapsed Signer',
    notBefore: new Date(Date.UTC(2015, 0, 1)),
    notAfter: new Date(Date.UTC(2016, 0, 1)),
  });
}, 30_000);

describe('readKeyFile, on a current PKCS#12', () => {
  it('is recognised as one the bundle can open by itself', () => {
    expect(detectKeyFile('max.p12', keys.modern).kind).toBe('pkcs12');
  });

  it('yields the certificate and a key that signs', async () => {
    const [identity, ...rest] = await readKeyFile('max.p12', keys.modern, keys.password);

    expect(rest).toHaveLength(0);
    expect(identity.subject).toBe('Max Svoboda');
    expect(identity.issuer).toBe('Max Svoboda');

    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      identity.key,
      new TextEncoder().encode('bytes to sign'),
    );
    expect(signature.byteLength).toBe(256);
  });

  it('hands back a key the page cannot read out again', async () => {
    // The whole point of importing through WebCrypto. Even this app cannot
    // recover the key material once it is in, which is the property that makes
    // "the key never leaves the device" mean something.
    const [identity] = await readKeyFile('max.p12', keys.modern, keys.password);

    expect(identity.key.extractable).toBe(false);
    expect(identity.key.usages).toEqual(['sign']);
    await expect(crypto.subtle.exportKey('pkcs8', identity.key)).rejects.toThrow();
  });

  it('says the password is wrong rather than that the file is broken', async () => {
    const failure = await readKeyFile('max.p12', keys.modern, 'not-the-password').catch((e) => e);

    expect(failure).toBeInstanceOf(UnreadableKeyFile);
    expect(failure.problem).toBe('password');
    expect(failure.message).toMatch(/password/i);
  });
});

describe('readKeyFile, on a PKCS#12 a certificate authority would send', () => {
  it('is recognised as needing the fallback before a password is typed', () => {
    // The detection that decides whether node-forge is fetched at all. It has
    // to work on the bytes alone, or the interface would have to ask for a
    // password before it could say what the file is.
    expect(detectKeyFile('postsignum.p12', keys.legacy).kind).toBe('pkcs12-legacy');
  });

  it('opens through the fallback and yields the same shape', async () => {
    const [identity] = await readKeyFile('postsignum.p12', keys.legacy, keys.password);

    expect(identity.subject).toBe('Max Svoboda');
    expect(identity.key.extractable).toBe(false);

    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      identity.key,
      new TextEncoder().encode('bytes to sign'),
    );
    expect(signature.byteLength).toBe(256);
  });

  it('signs identically whichever route opened it', async () => {
    // The property that makes the fallback safe to have: it decrypts a
    // container and changes nothing else. The same key through both routes has
    // to produce the same signature over the same bytes.
    const message = new TextEncoder().encode('one message, two containers');
    const [viaPkijs] = await readKeyFile('max.p12', keys.modern, keys.password);
    const [viaForge] = await readKeyFile('postsignum.p12', keys.legacy, keys.password);

    const first = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', viaPkijs.key, message));
    const second = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', viaForge.key, message));

    expect([...second]).toEqual([...first]);
  });

  it('reports a wrong password as a wrong password here too', async () => {
    const failure = await readKeyFile('postsignum.p12', keys.legacy, 'wrong').catch((e) => e);

    expect(failure).toBeInstanceOf(UnreadableKeyFile);
    expect(failure.problem).toBe('password');
  });
});

describe('readKeyFile, on PEM', () => {
  it('reads an unencrypted certificate and key without fetching anything', async () => {
    const [identity] = await readKeyFile('max.pem', new TextEncoder().encode(keys.pem), '');

    expect(identity.subject).toBe('Max Svoboda');
    expect(identity.key.extractable).toBe(false);
  });

  it('refuses a certificate with no key beside it, and says why', async () => {
    const failure = await readKeyFile(
      'cert.pem',
      new TextEncoder().encode(keys.certificateOnlyPem),
      '',
    ).catch((e) => e);

    expect(failure.problem).toBe('no-key');
    expect(failure.message).toMatch(/cannot sign/);
  });
});

describe('readKeyFile, on what it will not read', () => {
  it('refuses a Java keystore with the command that converts it', async () => {
    const jks = new Uint8Array([0xfe, 0xed, 0xfe, 0xed, 0, 0, 0, 2]);
    const failure = await readKeyFile('keys.jks', jks, 'secret').catch((e) => e);

    expect(failure.problem).toBe('refused');
    expect(failure.message).toContain('keytool -importkeystore');
  });
});

describe('validityAt', () => {
  it('reports an expired certificate without refusing it', async () => {
    // Reported, not enforced: an expired certificate still makes a sound
    // signature, and whether that is worth anything is a question about trust
    // this app does not answer.
    const [identity] = await readKeyFile('old.p12', expired.modern, expired.password);

    expect(validityAt(identity, new Date(Date.UTC(2026, 0, 1)))).toBe('expired');
    expect(validityAt(identity, new Date(Date.UTC(2015, 5, 1)))).toBe('valid');
    expect(validityAt(identity, new Date(Date.UTC(2014, 0, 1)))).toBe('not-yet-valid');
  });
});

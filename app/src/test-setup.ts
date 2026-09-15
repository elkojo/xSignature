/**
 * Give Node the Web Crypto the browser already has.
 *
 * The app's code calls the global `crypto`, which is right: it is what every
 * browser provides and what the app actually runs against. Node only exposes it
 * globally from version 19, and this project supports 18.17 — so rather than
 * make the library reach for a Node module it would never use in production,
 * the gap is filled here, where only the test run sees it.
 */
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

/**
 * And give PKI.js an engine to use it through.
 *
 * In a browser it finds `window.crypto` by itself, which is why the app never
 * sets one. Under Node it finds nothing and every verification fails with a
 * message about a missing engine rather than about the document.
 */
import { CryptoEngine, setEngine } from 'pkijs';

setEngine('node', new CryptoEngine({ name: 'node', crypto: globalThis.crypto }));

/**
 * And let the suite fetch the files the build serves.
 *
 * A bundled font arrives through `import … from './x.ttf?url'`, which is a URL
 * the dev server and the built site both answer. Under Node there is no server,
 * so `fetch` is given a path it cannot resolve. Reading it off disk here keeps
 * the library code identical to what ships — the alternative is a branch in
 * `loadFace` that exists only for tests, which would mean the tested path and
 * the shipped path are not the same path.
 */
/**
 * Node 18 has no `Promise.withResolvers`; pdf.js uses it. Filled in here rather
 * than avoided, because reading a produced PDF back with a different library is
 * the only honest way to test that one is readable.
 */
if (!(Promise as unknown as { withResolvers?: unknown }).withResolvers) {
  (Promise as unknown as { withResolvers: unknown }).withResolvers = function withResolvers() {
    let resolve!: (value: unknown) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  if (url.startsWith('/') && !url.startsWith('//')) {
    const bytes = await readFile(resolve(process.cwd(), `.${url}`));
    return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
      status: 200,
    });
  }

  return realFetch(input, init);
}) as typeof fetch;

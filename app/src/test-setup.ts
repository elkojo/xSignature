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

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

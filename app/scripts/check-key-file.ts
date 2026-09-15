/**
 * Say what a key file is, without opening it.
 *
 * This is a development tool, not part of the app. It exists because the unit
 * suite cannot test against the file that prompted the whole feature: a real
 * certificate authority's export, whose password belongs to its owner and whose
 * bytes may not be committed. What the suite can reproduce is the encryption
 * profile; what it cannot is the file itself.
 *
 * So this reports what the reader would decide about a real file, using only
 * the parts that are in the clear. It never asks for a password, never
 * decrypts anything, and prints nothing out of the file but the names of
 * algorithms.
 *
 *   npm run check:key -- ~/certificates/yours.p12
 *
 * Add `--password` to go further and actually open it. That prints the subject
 * and the validity dates, and is the one way to confirm a real file end to
 * end. It reads the password from the `KEY_PASSWORD` environment variable
 * rather than from the command line, so it does not end up in a shell history.
 */
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { CryptoEngine, setEngine } from 'pkijs';

import { detectKeyFile } from '../src/lib/document/certificate/read/detect';
import { validityAt } from '../src/lib/document/certificate/read/identity';
import { readKeyFile } from '../src/lib/document/certificate/read/read';

// Node exposes Web Crypto globally only from version 19, and this project
// supports 18.17. The app never needs this — a browser has it — so the gap is
// filled here, exactly as `src/test-setup.ts` fills it for the suite.
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
setEngine('node', new CryptoEngine({ name: 'node', crypto: globalThis.crypto }));

const path = process.argv[2];
const open = process.argv.includes('--password');

if (!path) {
  console.error('Usage: npm run check:key -- <file> [--password]');
  process.exit(1);
}

const bytes = new Uint8Array(readFileSync(path));
const name = basename(path);
const detected = detectKeyFile(name, bytes);

console.log(`\n${name} — ${bytes.length} bytes\n`);
console.log(`  format    ${detected.format}`);
console.log(`  kind      ${detected.kind}`);
console.log(
  `  opens     ${
    {
      pkcs12: 'with pkijs, which is already in the bundle',
      'pkcs12-legacy': 'only through the node-forge fallback',
      pem: 'directly, unless the key is encrypted',
      jks: 'not at all',
      unknown: 'not at all',
    }[detected.kind]
  }`,
);
if (detected.reason) console.log(`\n  ${detected.reason.replace(/\n/g, '\n  ')}`);

if (!open) {
  console.log('\n  Pass --password, with KEY_PASSWORD set, to open it as the app would.\n');
  process.exit(0);
}

const password = process.env.KEY_PASSWORD;
if (password === undefined) {
  console.error('\n  Set KEY_PASSWORD to open the file. An empty value is a valid password.\n');
  process.exit(1);
}

const identities = await readKeyFile(name, bytes, password, detected);
console.log(`\n  ${identities.length} identit${identities.length === 1 ? 'y' : 'ies'} inside:\n`);

for (const identity of identities) {
  const state = validityAt(identity, new Date());
  console.log(`  · ${identity.subject}`);
  console.log(`      issued by   ${identity.issuer}`);
  console.log(`      valid       ${identity.validFrom.toISOString().slice(0, 10)} to ${identity.validTo.toISOString().slice(0, 10)} (${state})`);
  console.log(`      chain       ${identity.chain.length} further certificate(s) in the file`);
  console.log(`      key         ${identity.key.algorithm.name}, extractable: ${identity.key.extractable}`);
}
console.log();

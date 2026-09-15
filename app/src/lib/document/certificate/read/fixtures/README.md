# Key files, and why there are none here

Every other fixture directory in this project holds a captured artefact. This
one holds a generator instead, because the artefact would be a private key.

`.gitignore` refuses `*.p12`, `*.pfx`, `*.jks`, `*.pem` and `*.key` by
extension. That rule exists for real files, and weakening it for a throwaway
test key would weaken it for the next file too — the rule is only worth having
if it has no exceptions. So `make-keys.ts` builds what the tests need, in
memory, when they run.

The profiles it produces are the ones the reader branches on:

- **modern** — PBES2, AES-256, what a current OpenSSL writes by default
- **legacy** — 3DES, what a certificate authority's export still writes

One layer is missing, deliberately. A real PostSignum file wraps its
certificates in RC2-40, which node-forge can read but cannot write, so no
generator here can produce one. That layer lives inside the fallback rather
than in this app — the container is handed over whole — so what the suite
leaves untested there is somebody else's code. To check a real file end to end,
point `npm run check:key` at it; it reports what the file is without asking for
a password.

# Captured replies

`digicert-response.der` is a real RFC 3161 reply, fetched once from
`https://rfc3161.ai.moda/digicert` and committed here so the tests can read a
genuine timestamp without going near the network.

It answers a request over the SHA-256 of the ASCII bytes
`xSignature fixture document`, with the nonce `4d1a9c0755e32168`. The token
inside it is signed by DigiCert and was granted at 2026-09-14T19:03:57Z.

Recapturing it is not routine — the tests assert on the values above, and a new
capture would change all of them. It exists so that parsing a real authority's
output is tested against that authority's actual output rather than against
something this project made up about it.

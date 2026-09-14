# A timestamped document

`timestamped.pdf` was produced by this app and stamped once by DigiCert, then
committed so the checker is tested against a real authority's output rather than
against something this project made up about it.

The tests alter copies of it in memory — a byte of the document, a byte of the
token — and expect the two failures to be told apart: a changed document is
`altered`, a token that no longer verifies against its own certificate is
`broken`. Nothing here reaches the network.

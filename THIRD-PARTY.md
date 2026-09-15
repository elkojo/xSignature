# Third-party notices

xSignature is licensed under the AGPL-3.0-or-later. This file lists the
third-party code and fonts that are part of what a browser downloads when it
loads the app.

Nothing here is fetched at runtime from anyone else's server. Every file below
is built into the bundle and served from the same origin as the app.

## Code

| Package | Version | Licence | Used for |
| --- | --- | --- | --- |
| [opentype.js](https://github.com/opentypejs/opentype.js) | 2.0.0 | MIT | Reading `.ttf` files and turning text into glyph outlines |
| [signature_pad](https://github.com/szimek/signature_pad) | 5.1.4 | MIT | Smoothing pointer input into curves, and weighting them by pen speed |
| [@cantoo/pdf-lib](https://github.com/cantoo-scribe/pdf-lib) | 2.11.0 | MIT | Reading a PDF and writing the signature onto one of its pages |
| [pdfjs-dist](https://github.com/mozilla/pdf.js) | 6.3.289 | Apache-2.0 | Drawing a page on screen so the signature can be positioned on it |
| [pkijs](https://github.com/PeculiarVentures/PKI.js) | 3.4.0 | BSD-3-Clause | Building the RFC 3161 timestamp request and reading the reply |
| [asn1js](https://github.com/PeculiarVentures/ASN1.js) | 3.0.10 | BSD-3-Clause | The ASN.1 encoding underneath it |
| [marked](https://github.com/markedjs/marked) | 18.0.13 | MIT | Parsing Markdown, so a `.md` can be set as a PDF without a converter |
| [node-forge](https://github.com/digitalbazaar/forge) | 1.4.0 | BSD-3-Clause | Opening key files a certificate authority encrypted the old way |

MIT and the AGPL-3.0-or-later are satisfied by shipping the notices; MIT imposes
no copyleft obligation on this project. Apache-2.0 is one-way compatible with
the AGPL-3.0-or-later, which is the direction needed here: Apache-licensed code
may be included in an AGPL work.

`@cantoo/pdf-lib` is a maintained fork of [pdf-lib](https://github.com/Hopding/pdf-lib),
which has had no release since 2021. The fork is used rather than the original
because it appends changes to a PDF as an incremental update instead of
rewriting the file — which is what a document timestamp will need, and what
keeps an existing document's own bytes intact.

node-forge is dual-licensed BSD-3-Clause or GPL-2.0; this project takes the
BSD-3-Clause branch, which the AGPL-3.0-or-later may include.

It is also the only entry in this table that is **not** downloaded when the app
loads. It is fetched at the moment somebody opens a key file that turns out to
need it, and never otherwise.

That it is needed at all is a fact about certificate authorities rather than a
preference. WebCrypto implements neither RC2 nor 3DES and never will, and PKI.js
implements only PBES2 — so between them they open a `.p12` written by a current
OpenSSL and nothing older. Real exports are older: a PostSignum file protects
its private key with 3DES and its certificates with RC2-40. Without this
library, the files people actually hold could not be opened at all.

What it is allowed to do is narrow. It decrypts the container, hands over the
private key as ordinary PKCS#8, and stops. That key is imported into WebCrypto
as non-extractable before anything else sees it, so every signature this app
makes is made by the platform, and the key cannot be read back out — by
node-forge, by this app, or by a page running beside it.

PKI.js reads and writes the ASN.1 structures a timestamp is made of, and checks
one on the way back in. It does
not verify the authority's certificate chain and is not asked to: that would
need a trust store this app has no business shipping or keeping current, and
revocation would need a network it does not use. So the Check screen reports the
signer's name exactly as the token states it, says in as many words that
vouching for that name is a PDF reader's job, and confines itself to what it can
actually establish — that the document still matches the timestamp, and that the
token's own signature holds against the certificate inside it.

PDF.js is used only to *display* a page. Nothing it renders is written into the
saved document, and its worker is served from this origin: its own default is a
CDN, which would be both a third-party request and a dependency on being
online, so the app sets the worker path explicitly.

## Fonts

Every bundled face is licensed under the **SIL Open Font License 1.1**. Each
`.ttf` ships with its own licence text beside it, named after the font file,
and a README beside those records which npm package and which upstream version
each file came from. The signature faces are in
`app/src/lib/signature/fonts/`; the text face used by a visible signature's
details block is in `app/src/lib/document/certificate/appearance/fonts/`.

| Font | File | Copyright |
| --- | --- | --- |
| Dancing Script | `DancingScript-Regular.ttf` | 2016 The Dancing Script Project Authors, with Reserved Font Name "Dancing Script" |
| Caveat | `Caveat-Regular.ttf` | 2014 The Caveat Project Authors |
| Great Vibes | `GreatVibes-Regular.ttf` | 2015 The Great Vibes Pro Project Authors |
| Allura | `Allura-Regular.ttf` | 2010 The Allura Project Authors |
| Parisienne | `Parisienne-Regular.ttf` | 2011 Alejandro Paul (Sudtipos) |
| Sacramento | `Sacramento-Regular.ttf` | 2012 Brian J. Bonislawsky DBA Astigmatic, with Reserved Font Name "Sacramento" |
| Mr De Haviland | `MrDeHaviland-Regular.ttf` | 2012 Brian J. Bonislawsky DBA Astigmatic |
| Inter | `Inter-Regular-Latin.ttf` | 2020 The Inter Project Authors |
| Inter Bold | `Inter-Bold-Latin.ttf` | 2020 The Inter Project Authors |
| Inter Italic | `Inter-Italic-Latin.ttf` | 2020 The Inter Project Authors |
| Inter Bold Italic | `Inter-BoldItalic-Latin.ttf` | 2020 The Inter Project Authors |
| JetBrains Mono | `JetBrainsMono-Regular-Latin.ttf` | 2020 The JetBrains Mono Project Authors |

All twelve are OFL-1.1.

The seven signature faces are copied verbatim — not subset, not re-encoded, not
renamed — so the Reserved Font Name clause is satisfied for those that declare
one.

**The five text faces are the exception, and are subset.** They carry Basic
Latin, Latin-1 Supplement and Latin Extended-A, which is what lets a document
spell a Czech, Polish or Hungarian word: PDF's own built-in fonts are WinAnsi
and write `?` instead, silently, in the body of whatever is being signed. The
full faces cost about four times the subsets.

Subsetting is a modification, so it is worth being exact about why it is
permitted: neither Inter's nor JetBrains Mono's copyright line declares a
Reserved Font Name — unlike, say, Sacramento, which reserves its own — so the
OFL's renaming requirement does not apply. The licence travels with each file
and the subsets stay under the OFL, which is the rest of what it asks.

They are not offered as signature faces, and live in their own directory so
that nothing enumerating the signature faces can reach them. Each is a separate
asset fetched only when a document actually needs it: a memo with nothing
emphasised never downloads the italic.

A font whose licence has not been read is never added: `npm run fonts:vendor`
refuses to bundle a file whose
accompanying licence is not the OFL, which is what caught these packages
shipping MIT at `LICENSE` and the font's real licence at `LICENSE_FONT`.

Homemade Apple was on the candidate list and is **not** bundled: it is
distributed under Apache-2.0 rather than the OFL.

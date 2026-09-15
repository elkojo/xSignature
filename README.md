# xSignature

**[elkojo.github.io/xSignature](https://elkojo.github.io/xSignature/)**

Type your name in a handwriting face, or draw it freehand, and export a clean
transparent PNG or a true vector SVG. Put that signature onto a PDF, and read a
PDF back to see whether it has been changed since it was stamped. Everything
happens in the browser.

Three screens:

- **Signature image** — make a signature and save it as a PNG or an SVG.
- **Sign a document** — open a PDF, bring in a signature by pasting, dropping or
  choosing it, place it on a page and save the result. Plain text and Markdown
  are laid out as a PDF first, here on the device. Optionally sign it with your
  own certificate, and optionally attach a timestamp.
- **Check a PDF** — read any PDF and report whether it carries a timestamp,
  whether the document still matches it, and whether anything was appended
  afterwards.

xSignature is a standalone app. It has no backend of its own and talks to no
other application: the page loads, and from then on everything it does happens
on your machine. The single exception is the timestamp, which is opt-in, off by
default, and described under [Privacy](#privacy). It shares its design language
and its privacy posture with [xNotary](https://xnotary.digital), and nothing
else — no shared account, no shared storage, no traffic between them.

## Two different claims

xSignature makes two things, and the difference between them is the most
important thing on this page.

A **picture of a signature** — typed or drawn, exported as a PNG or an SVG, or
placed on a PDF. It has no legal weight, no audit trail and no identity
binding. It proves nothing about who made it: anyone who has the file can put
it on any document. It is for letterheads, email footers, form fields and
branding.

A **certificate signature** — a PAdES signature made with a private key you
supply, covering the exact bytes of the finished PDF. This one proves
something: that whoever held that key signed these bytes, and that they have
not changed since. It is an *advanced* electronic signature.

It is **not** a qualified one and cannot become one here. A qualified signature
needs the key to live in certified hardware that only you can use; a key file a
browser can read is one that can be copied. The app also does not check whose
certificate it is — it signs with the key it is given, and says so. Judging
that is your PDF reader's job, against a trust list this app does not ship.

The timestamp is a third claim, and what it is worth depends on what it is
attached to. On its own it establishes one fact and no others: that a file
existed at a particular time, according to an authority that has never heard of
whoever made it. Attached to a certificate signature it says more — that the
*signature* existed then, so the time of signing stops resting on the signer's
own computer clock. That is a PAdES-B-T signature, and it is one network
request, not two.

## Key files

`.p12`, `.pfx` and `.pem`. The password opens the file and is then forgotten;
the private key is imported as a non-extractable key, so once it is in, not
even this app can read it back out.

Two routes open a `.p12`, chosen from the file's own bytes before a password is
asked for. A current export is PBES2 and AES, which the bundled PKI library
reads. A certificate authority's export usually is not: PostSignum wraps its
key in 3DES and its certificates in RC2-40, and WebCrypto implements neither
cipher — so for those files, and only those, node-forge is fetched to open the
container. It decrypts and nothing more; every signature is made by WebCrypto.

Java keystores are refused with the `keytool` command that converts them. The
format is Sun's own and its keys are wrapped in a cipher with no standard
behind it.

## How it works

Both ways of making a signature end up as the same thing: a list of path
commands. Typed text is read out of a bundled `.ttf` with opentype.js and
converted to glyph outlines; drawn strokes are smoothed by signature_pad and
then offset into closed outlines of their own. One pipeline measures, trims and
writes both of them, which is why the PNG and the SVG are the same picture
rather than two renderings that resemble each other.

The SVG contains paths and no `<text>`, so it opens correctly on a machine that
has none of these fonts installed.

A signature reaches the signing screen as a file — pasted, dropped or chosen.
An SVG made here comes back as the same outlines it left as, because `toSvg`
bakes its offset into the path data rather than using a transform, so the `d`
string is already in the space the stamp draws in; it goes onto the page as
paths, not as a picture of paths. A PNG is placed as an image, which is not a
lesser answer — a scanned signature has no vector form at all. What it costs is
measured rather than assumed: the app works out the effective resolution where
the picture is actually placed and says so only when that is genuinely too low.

Placement is one affine matrix either way, which is what keeps a signature right
on a page that is stored rotated or cropped differently from how it is
displayed. An image gets one extra matrix in front, reconciling its y-up unit
square with the y-down space the ink is measured in, so a picture and outlines
of the same proportions land on exactly the same spot.

A certificate signature is a detached CMS SignedData over the same byte range,
in a `/Sig` dictionary of subtype `ETSI.CAdES.detached`. It carries the
signing-certificate-v2 attribute, which binds it to one certificate by its hash
rather than to whichever certificate in the file happens to fit. A visible
signature draws its block — the signature, a logo if you add one, and whichever
of the name, reason and location you filled in — into the signature's own
appearance stream, so what you see is part of what is signed rather than
content that happens to sit underneath it. That block is drawn as outlines in a
bundled face, because PDF's built-in fonts cannot spell a Czech name.

A timestamp takes one of two forms, depending on what there is to timestamp.

Without a certificate it is a PAdES document timestamp — `/DocTimeStamp`,
`/ETSI.RFC3161` — written as an incremental update, so the bytes that arrived
are left exactly as they were. It is deliberately not a signature dictionary: a
document timestamp needs no private key, no certificate and no identity, and
claims none.

With a certificate it goes *inside* the signature, as the unsigned attribute
`id-aa-signatureTimeStampToken`, over the signature value rather than over the
document. Unsigned because it cannot be otherwise: the token is a statement
about the signature, so it cannot exist until the signature does, and so cannot
be covered by it. That is also what lets one be attached without disturbing the
signature it describes. The Check screen reads it back and compares its imprint
against the signature it is attached to — a real token from a real authority,
over some other signature, would otherwise read as corroboration and be none.

## Formats

PDFs are stamped directly. Plain text (`.txt`, `.log`) and Markdown (`.md`) are
laid out as a PDF on the device, using the fonts every PDF reader already has —
nothing is fetched to do it.

Nothing else is read. Word, OpenDocument and the rest are turned away with a
reason: converting them faithfully would mean either a very large converter
downloaded at runtime or a hand-written reader for each format, and a word
processor's own *Save As PDF* does a better job of its own formatting than
either. There is no plan to add one.

## Running it

Node 18.17 or newer.

```
cd app
npm install
npm run dev
```

`npm test` runs the unit suite and `npm run typecheck` runs `svelte-check`.
`npx vite build` produces a static site in `app/dist`; set `BASE_PATH` when it
is served from a subdirectory, as the deployed copy is:

```
BASE_PATH=/xSignature/ npx vite build
```

Two things the unit suite cannot reach, because they need a browser rather than
node — rasterising to a canvas, and the pointer handling behind draw mode — have
manual checks instead. Run `npm run dev`, then open
`/scripts/png-check.html` and `/scripts/draw-check.html` and read the console.

## Privacy

The name you type, the strokes you draw, the documents you open and any key
file you use never leave the device. There is no backend, no API, no upload, no analytics and no CDN —
fonts are bundled into the build. Nothing is persisted except your last-used
settings (face, colour, size) in `localStorage`.

There is exactly one exception, and it is opt-in and off by default. Asking for
a timestamp sends a 32-byte SHA-256 of the finished PDF to a timestamp
authority, because that is the only way a timestamp can mean anything —
somebody independent has to see it. The document itself does not go, and the
digest cannot be turned back into it. The interface states this before it
happens, and shows the exact digest afterwards.

CI enforces the rest: every host named anywhere in the build is checked against
[`app/hosts-in-build.txt`](app/hosts-in-build.txt), and a host that is not
written down there fails the build.

## Licence

AGPL-3.0-or-later. See [LICENSE](LICENSE).

# xSignature

**[elkojo.github.io/xSignature](https://elkojo.github.io/xSignature/)**

Type your name in a handwriting face, or draw it freehand, and export a clean
transparent PNG or a true vector SVG. Put that signature onto a PDF, and read a
PDF back to see whether it has been changed since it was stamped. Everything
happens in the browser.

Three screens:

- **Signature image** — make a signature and save it as a PNG or an SVG.
- **Sign a document** — open a PDF, place the signature on a page, save the
  result. Plain text and Markdown are laid out as a PDF first, here on the
  device. Optionally attach a timestamp.
- **Check a PDF** — read any PDF and report whether it carries a timestamp,
  whether the document still matches it, and whether anything was appended
  afterwards.

xSignature is a standalone app. It has no backend of its own and talks to no
other application: the page loads, and from then on everything it does happens
on your machine. The single exception is the timestamp, which is opt-in, off by
default, and described under [Privacy](#privacy). It shares its design language
and its privacy posture with [xNotary](https://xnotary.digital), and nothing
else — no shared account, no shared storage, no traffic between them.

## What this is not

xSignature produces a **picture of a signature**. It has no legal weight, no
audit trail and no identity binding, and it is not an electronic signature in
any regulatory sense. It is for letterheads, email footers, form fields and
branding. If you need to prove who signed a document, you need a qualified
electronic signature, which this is not.

The timestamp does not change that. It establishes one fact and no others: that
a file existed at a particular time, according to an authority that has never
heard of whoever made it. It says nothing about who wrote the document, who put
a signature on it, or whether anyone agreed to anything.

## How it works

Both ways of making a signature end up as the same thing: a list of path
commands. Typed text is read out of a bundled `.ttf` with opentype.js and
converted to glyph outlines; drawn strokes are smoothed by signature_pad and
then offset into closed outlines of their own. One pipeline measures, trims and
writes both of them, which is why the PNG and the SVG are the same picture
rather than two renderings that resemble each other.

The SVG contains paths and no `<text>`, so it opens correctly on a machine that
has none of these fonts installed.

A signature goes onto a PDF as those same paths, not as a picture of them, so it
stays sharp at any zoom and the document's own text stays text. Placement is one
affine matrix, which is what keeps it right on a page that is stored rotated or
cropped differently from how it is displayed.

A timestamp is a PAdES document timestamp — `/DocTimeStamp`, `/ETSI.RFC3161` —
written as an incremental update, so the bytes that arrived are left exactly as
they were. It is deliberately not a signature dictionary: a document timestamp
needs no private key, no certificate and no identity, and claims none.

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

The name you type, the strokes you draw and the documents you open never leave
the device. There is no backend, no API, no upload, no analytics and no CDN —
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

# xSignature

**[elkojo.github.io/xSignature](https://elkojo.github.io/xSignature/)**

Type your name in a handwriting face, or draw it freehand, and export a clean
transparent PNG or a true vector SVG. Everything happens in the browser.

xSignature is a standalone app. It talks to no server and to no other
application: the page loads, and from then on everything it does happens on your
machine. It shares its design language and its privacy posture with
[xNotary](https://xnotary.digital), and nothing else — no shared account, no
shared storage, no traffic between them.

## What this is not

xSignature produces a **picture of a signature**. It has no legal weight, no
audit trail and no identity binding, and it is not an electronic signature in
any regulatory sense. It is for letterheads, email footers, form fields and
branding. If you need to prove who signed a document, you need a qualified
electronic signature, which this is not.

## How it works

Both ways of making a signature end up as the same thing: a list of path
commands. Typed text is read out of a bundled `.ttf` with opentype.js and
converted to glyph outlines; drawn strokes are smoothed by signature_pad and
then offset into closed outlines of their own. One pipeline measures, trims and
writes both of them, which is why the PNG and the SVG are the same picture
rather than two renderings that resemble each other.

The SVG contains paths and no `<text>`, so it opens correctly on a machine that
has none of these fonts installed.

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

The name you type and the strokes you draw never leave the device. There is no
backend, no API, no upload, no analytics and no CDN — fonts are bundled into the
build. Nothing is persisted except your last-used settings (face, colour, size)
in `localStorage`.

## Licence

AGPL-3.0-or-later. See [LICENSE](LICENSE).

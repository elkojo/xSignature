# xSignature

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

## Running it

Node 18.17 or newer.

```
cd app
npm install
npm run dev
```

`npm run build` produces a static site in `app/dist`. `npm test` runs the unit
suite; `npm run typecheck` runs `svelte-check`.

## Privacy

The name you type and the strokes you draw never leave the device. There is no
backend, no API, no upload, no analytics and no CDN — fonts are bundled into the
build. Nothing is persisted except your last-used settings (face, colour, size)
in `localStorage`.

## Licence

AGPL-3.0-or-later. See [LICENSE](LICENSE).

# xSignature

Type your name in a handwriting face, or draw it freehand, and export a clean
transparent PNG or a true vector SVG. Everything happens in the browser.

xSignature is a module of [xNotary](https://xnotary.digital). This repository is
the module developed on its own, with a minimal dev shell around it so it runs
standalone; the module itself is `app/src/lib/signature/` and
`app/src/views/Signature.svelte`, and those are the paths it occupies inside
xNotary too.

## What this is not

xSignature produces a **picture of a signature**. It has no legal weight, no
audit trail and no identity binding, and it is not an electronic signature in
any regulatory sense. It is for letterheads, email footers, form fields and
branding. To prove who signed a document, use xNotary's Signatures module.

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

AGPL-3.0-or-later, the same as xNotary. See [LICENSE](LICENSE).

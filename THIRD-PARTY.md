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

Both MIT and the AGPL-3.0-or-later are satisfied by shipping the notices; MIT
imposes no copyleft obligation on this project.

## Fonts

Every bundled face is licensed under the **SIL Open Font License 1.1**. Each
`.ttf` ships with its own licence text beside it in
`app/src/lib/signature/fonts/`, named after the font file, and
`app/src/lib/signature/fonts/README.md` records which npm package and which
upstream version each file came from.

| Font | File | Licence | Copyright |
| --- | --- | --- | --- |
| Dancing Script | `DancingScript-Regular.ttf` | OFL-1.1 | 2016 The Dancing Script Project Authors, with Reserved Font Name "Dancing Script" |

The fonts are copied verbatim — not subset, not re-encoded, not renamed — so
the Reserved Font Name clause is satisfied. A font whose licence has not been
read is never added; `npm run fonts:vendor` refuses to bundle a file whose
accompanying licence is not the OFL.

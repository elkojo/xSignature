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

| Font | File | Copyright |
| --- | --- | --- |
| Dancing Script | `DancingScript-Regular.ttf` | 2016 The Dancing Script Project Authors, with Reserved Font Name "Dancing Script" |
| Caveat | `Caveat-Regular.ttf` | 2014 The Caveat Project Authors |
| Great Vibes | `GreatVibes-Regular.ttf` | 2015 The Great Vibes Pro Project Authors |
| Allura | `Allura-Regular.ttf` | 2010 The Allura Project Authors |
| Parisienne | `Parisienne-Regular.ttf` | 2011 Alejandro Paul (Sudtipos) |
| Sacramento | `Sacramento-Regular.ttf` | 2012 Brian J. Bonislawsky DBA Astigmatic, with Reserved Font Name "Sacramento" |
| Mr De Haviland | `MrDeHaviland-Regular.ttf` | 2012 Brian J. Bonislawsky DBA Astigmatic |

All seven are OFL-1.1.

The fonts are copied verbatim — not subset, not re-encoded, not renamed — so
the Reserved Font Name clause is satisfied. A font whose licence has not been
read is never added: `npm run fonts:vendor` refuses to bundle a file whose
accompanying licence is not the OFL, which is what caught these packages
shipping MIT at `LICENSE` and the font's real licence at `LICENSE_FONT`.

Homemade Apple was on the candidate list and is **not** bundled: it is
distributed under Apache-2.0 rather than the OFL.

import { parse, type Font } from 'opentype.js';

import type { Face } from './faces';

/**
 * Load and parse a bundled `.ttf`.
 *
 * `.ttf` rather than `.woff2` is not a preference: opentype.js cannot read
 * woff2, and reading the raw glyph outlines is the whole architecture. A face
 * the parser cannot open is a face this app cannot use.
 *
 * The fetch is same-origin, for a file that is part of this build. It is the
 * only request the app makes after the page has loaded, and once the browser
 * has cached it there are none.
 */
const cache = new Map<string, Promise<Font>>();

export function loadFace(face: Face): Promise<Font> {
  const hit = cache.get(face.id);
  if (hit) return hit;

  const pending = fetch(face.url)
    .then(async (response) => {
      if (!response.ok) throw new Error(`${face.name}: ${response.status} ${response.statusText}`);
      return parse(await response.arrayBuffer());
    })
    .catch((cause) => {
      // Don't cache a failure: a face that failed once because the app was
      // offline mid-load should be loadable on the next attempt.
      cache.delete(face.id);
      throw new Error(`Could not load ${face.name}.`, { cause });
    });

  cache.set(face.id, pending);
  return pending;
}

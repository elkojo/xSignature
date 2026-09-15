/**
 * The face the details block is set in.
 *
 * Loaded the same way a signature face is — fetched from this build, parsed by
 * opentype.js, cached — and for the same reason: it becomes outlines rather
 * than text that needs a font to render.
 *
 * There is one of it and it is not chosen by anyone, so this is simpler than
 * `signature/type/font.ts`: no id, no cache keyed by face, just the one
 * promise, kept so that opening the screen twice does not fetch it twice.
 */
import { parse, type Font } from 'opentype.js';

import url from '../../fonts/Inter-Regular-Latin.ttf?url';

let pending: Promise<Font> | null = null;

export function loadAppearanceFont(): Promise<Font> {
  pending ??= fetch(url)
    .then(async (response) => {
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return parse(await response.arrayBuffer());
    })
    .catch((cause) => {
      // Don't cache a failure: a load that failed because the app was offline
      // mid-fetch should be retried rather than remembered.
      pending = null;
      throw new Error('Could not load the face the signature block is set in.', { cause });
    });

  return pending;
}

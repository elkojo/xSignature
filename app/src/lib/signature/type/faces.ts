import allura from '../fonts/Allura-Regular.ttf?url';
import caveat from '../fonts/Caveat-Regular.ttf?url';
import dancingScript from '../fonts/DancingScript-Regular.ttf?url';
import greatVibes from '../fonts/GreatVibes-Regular.ttf?url';
import mrDeHaviland from '../fonts/MrDeHaviland-Regular.ttf?url';
import parisienne from '../fonts/Parisienne-Regular.ttf?url';
import sacramento from '../fonts/Sacramento-Regular.ttf?url';

/**
 * A bundled handwriting face.
 *
 * `url` points at a file in this build. Nothing here is fetched from a font
 * CDN — that would tell a third party that someone is making a signature, and
 * would break the app the moment it went offline. Each face is a separate
 * asset, fetched only when it is chosen, so picking one does not cost the other
 * six.
 */
export interface Face {
  /** Stable across releases: it is what gets written to localStorage. */
  readonly id: string;
  readonly name: string;
  /** What this face is like to look at, in the app's own plain voice. */
  readonly note: string;
  readonly url: string;
}

export const FACES: readonly Face[] = [
  {
    id: 'dancing-script',
    name: 'Dancing Script',
    note: 'Upright and legible',
    url: dancingScript,
  },
  { id: 'caveat', name: 'Caveat', note: 'Quick, ballpoint', url: caveat },
  { id: 'great-vibes', name: 'Great Vibes', note: 'Formal copperplate', url: greatVibes },
  { id: 'allura', name: 'Allura', note: 'Light and looping', url: allura },
  { id: 'parisienne', name: 'Parisienne', note: 'Narrow, slanted', url: parisienne },
  { id: 'sacramento', name: 'Sacramento', note: 'Thin monoline', url: sacramento },
  {
    id: 'mr-de-haviland',
    name: 'Mr De Haviland',
    note: 'Flourished — no Czech or Polish accents',
    url: mrDeHaviland,
  },
];

export const DEFAULT_FACE_ID = 'dancing-script';

export function faceById(id: string): Face | undefined {
  return FACES.find((f) => f.id === id);
}

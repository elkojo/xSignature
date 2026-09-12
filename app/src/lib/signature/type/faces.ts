import dancingScript from '../fonts/DancingScript-Regular.ttf?url';

/**
 * A bundled handwriting face.
 *
 * `url` points at a file in this build. Nothing here is fetched from a font CDN
 * — that would leak the fact that someone is making a signature, and to a third
 * party, which is the one thing this app promises never to do.
 */
export interface Face {
  /** Stable across releases: it is what gets written to localStorage. */
  readonly id: string;
  readonly name: string;
  readonly url: string;
}

export const FACES: readonly Face[] = [
  { id: 'dancing-script', name: 'Dancing Script', url: dancingScript },
];

export const DEFAULT_FACE_ID = 'dancing-script';

export function faceById(id: string): Face | undefined {
  return FACES.find((f) => f.id === id);
}

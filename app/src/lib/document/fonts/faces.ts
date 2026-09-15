/**
 * The faces this app sets documents in.
 *
 * Fetched from this build, parsed by opentype.js, and kept — the same way the
 * signature faces are, and for the same reason: what goes into a PDF is the
 * font's own glyph outlines and metrics, which needs the file rather than a
 * name.
 *
 * Both the raw bytes and the parsed font are returned. One is embedded in the
 * document for the reader to rasterize, the other decides which glyph each
 * character is and how wide it is; they have to be the same file or the
 * document draws different letters than it measures.
 *
 * Nothing is loaded until a document needs setting. Somebody stamping a PDF
 * that is already a PDF never fetches any of this.
 */
import { parse, type Font } from 'opentype.js';

import boldItalicUrl from './Inter-BoldItalic-Latin.ttf?url';
import boldUrl from './Inter-Bold-Latin.ttf?url';
import italicUrl from './Inter-Italic-Latin.ttf?url';
import regularUrl from './Inter-Regular-Latin.ttf?url';
import monoUrl from './JetBrainsMono-Regular-Latin.ttf?url';

/** The styles a laid-out document uses. */
export type Face = 'regular' | 'bold' | 'italic' | 'boldItalic' | 'mono';

export interface LoadedFace {
  readonly font: Font;
  /** Exactly the bytes `font` was parsed from. */
  readonly bytes: Uint8Array;
  /** A name for the PDF font dictionary. */
  readonly name: string;
}

const URLS: Record<Face, string> = {
  regular: regularUrl,
  bold: boldUrl,
  italic: italicUrl,
  boldItalic: boldItalicUrl,
  mono: monoUrl,
};

const NAMES: Record<Face, string> = {
  regular: 'InterLatin',
  bold: 'InterLatinBold',
  italic: 'InterLatinItalic',
  boldItalic: 'InterLatinBoldItalic',
  mono: 'JetBrainsMonoLatin',
};

const cache = new Map<Face, Promise<LoadedFace>>();

export function loadFace(face: Face): Promise<LoadedFace> {
  const hit = cache.get(face);
  if (hit) return hit;

  const pending = fetch(URLS[face])
    .then(async (response) => {
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      // Copied before parsing: opentype keeps a view on the buffer it was given,
      // and the same buffer is handed to the writer to embed.
      return { font: parse(bytes.slice().buffer), bytes, name: NAMES[face] };
    })
    .catch((cause) => {
      // A load that failed because the app was offline mid-fetch should be
      // retried rather than remembered as broken.
      cache.delete(face);
      throw new Error('Could not load the faces this document needs to be set in.', { cause });
    });

  cache.set(face, pending);
  return pending;
}

/** Load several at once, which is what laying a document out actually needs. */
export async function loadFaces<T extends Face>(faces: readonly T[]): Promise<Record<T, LoadedFace>> {
  const loaded = await Promise.all(faces.map((face) => loadFace(face)));
  return Object.fromEntries(faces.map((face, index) => [face, loaded[index]])) as Record<T, LoadedFace>;
}

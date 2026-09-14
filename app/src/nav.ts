/**
 * Routing. Two screens now, so the table earns its keep — the hash route is
 * what makes `#/signature` and `#/document` real addresses people can
 * bookmark, and keeping the table here means adding a screen never means
 * touching App.svelte's markup.
 */
export type View = 'signature' | 'document';

export const NAV: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'signature', label: 'Signature image' },
  { id: 'document', label: 'Sign a document' },
];

export const ROUTES: readonly View[] = ['signature', 'document'];

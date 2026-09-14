/**
 * Routing. Two screens now, so the table earns its keep — the hash route is
 * what makes `#/signature` and `#/document` real addresses people can
 * bookmark, and keeping the table here means adding a screen never means
 * touching App.svelte's markup.
 */
export type View = 'signature' | 'document';

export const NAV: ReadonlyArray<{ id: View; label: string; title: string }> = [
  { id: 'signature', label: 'Signature image', title: 'xSignature — Make a signature image' },
  { id: 'document', label: 'Sign a document', title: 'xSignature — Put a signature on a document' },
];

/** What the browser tab says. Falls back to the first screen's title. */
export function titleFor(view: View): string {
  return (NAV.find((item) => item.id === view) ?? NAV[0]).title;
}

export const ROUTES: readonly View[] = ['signature', 'document'];

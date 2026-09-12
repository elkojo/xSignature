/**
 * Routing. One screen today, so this is nearly a formality — but the hash route
 * is what makes `#/signature` a real address people can bookmark, and keeping
 * the table here means adding a second screen never means touching App.svelte's
 * markup.
 */
export type View = 'signature';

export const NAV: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'signature', label: 'Signature image' },
];

export const ROUTES: readonly View[] = ['signature'];

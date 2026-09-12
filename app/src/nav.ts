/**
 * Dev-shell routing only.
 *
 * In xNotary this file already exists and carries the real nav; adding the
 * module there means one entry — `{ id: 'signature', label: 'Signature image' }`
 * — and one branch in App.svelte. Nothing else in the parent changes.
 */
export type View = 'signature';

export const NAV: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'signature', label: 'Signature image' },
];

export const ROUTES: readonly View[] = ['signature'];

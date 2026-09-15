import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// Offline and deterministic, like xNotary's default suite. Nothing in this
// module may reach the network, so there is no spike config to separate out.
export default defineConfig({
  plugins: [svelte({ hot: false })],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
    /*
     * Longer than vitest's five seconds, because this suite does real work
     * rather than mocking it: RSA keys are generated, PDFs are written and
     * signed, and the results are read back with PDF.js. Any one of those is
     * comfortable on an idle machine and none of them is comfortable on a busy
     * one — a run sharing a laptop with a build failed twice, on a different
     * test each time and never the same one twice.
     *
     * Raising the ceiling rather than annotating forty-five tests: the default
     * was written for tests that do not do this, and a suite that signs
     * documents does. Individual tests that generate several keys still say so
     * themselves.
     */
    testTimeout: 30_000,
    hookTimeout: 60_000,
    server: {
      deps: {
        // pdf-lib's ES build imports its bundled font metrics as JSON. Left
        // external, Node loads those files itself and refuses them without an
        // import attribute it has no way to add. Inlining hands them to Vite,
        // which reads JSON without ceremony, and keeps the suite working on
        // every Node this project supports rather than only the newest.
        inline: ['@cantoo/pdf-lib'],
      },
    },
  },
});

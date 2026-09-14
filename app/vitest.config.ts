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

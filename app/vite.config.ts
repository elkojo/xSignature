import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

/**
 * Standalone dev/build config for xSignature.
 *
 * This exists so the module runs on its own during development. When the module
 * is dropped into xNotary it is `app/src/lib/signature/`, `app/src/views/` and
 * `app/src/signature.css` that move; nothing in this file goes with them, and
 * the parent's own vite.config.ts stays untouched.
 */
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [svelte()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});

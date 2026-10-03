import { defineConfig, normalizePath } from 'vite';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';

// Storybook supplies React and its renderer entry; do not load the legacy multi-page lab config.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  plugins: [tailwindcss()],
  // Storybook's index paths are cwd-relative, but its Vite root is design-lab/.
  // Absolute entries discover dependencies before first visits trigger full reloads.
  optimizeDeps: {
    entries: ['./*.stories.tsx', './preview.tsx'].map((path) =>
      normalizePath(fileURLToPath(new URL(path, import.meta.url))),
    ),
  },
  server: { host: '127.0.0.1', open: false, strictPort: true },
});

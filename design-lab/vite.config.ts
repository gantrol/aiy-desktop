import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import manifest from './cases.json';
const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root,
  base: './',
  resolve: {
    alias: {
      '@/renderer/components/media/mediaThumbnailUrl': fileURLToPath(new URL('./album-media.ts', import.meta.url)),
      '@': fileURLToPath(new URL('../src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'aiy-design-case-manifest',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'cases.json', source: JSON.stringify(manifest) });
      },
    },
  ],
  server: { host: '127.0.0.1', port: 4177, strictPort: true },
  build: {
    outDir: '../.tmp/design-lab',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        outline: fileURLToPath(new URL('./outline.html', import.meta.url)),
        albums: fileURLToPath(new URL('./albums.html', import.meta.url)),
        search: fileURLToPath(new URL('./search.html', import.meta.url)),
        calendar: fileURLToPath(new URL('./calendar.html', import.meta.url)),
        extensions: fileURLToPath(new URL('./extensions.html', import.meta.url)),
      },
    },
  },
});

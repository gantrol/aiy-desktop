import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import type { Plugin } from 'vite';

const sourceAlias = { '@': path.resolve(__dirname, 'src') };

function requireStandalonePreloadEntries(): Plugin {
  const expectedEntries = new Set(['index.js', 'image-decoder.js']);
  return {
    name: 'aiy-require-standalone-preload-entries',
    generateBundle(_options, bundle) {
      const entryFiles = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        if (!output.isEntry) this.error(`Sandboxed preload build created shared chunk ${output.fileName}`);
        entryFiles.add(output.fileName);
        const bundledImports = [...output.imports, ...output.dynamicImports].filter((id) => id !== 'electron');
        if (bundledImports.length) {
          this.error(`Sandboxed preload ${output.fileName} imports ${bundledImports.join(', ')}`);
        }
      }
      if (entryFiles.size !== expectedEntries.size || [...expectedEntries].some((entry) => !entryFiles.has(entry))) {
        this.error(`Unexpected sandboxed preload entries: ${[...entryFiles].join(', ')}`);
      }
    },
  };
}

export default defineConfig(({ command }) => {
  const productionBuild = command === 'build';
  const productionOutput = {
    minify: productionBuild ? ('esbuild' as const) : false,
    sourcemap: !productionBuild,
  };

  return {
    main: {
      resolve: { alias: sourceAlias },
      plugins: [externalizeDepsPlugin()],
      build: {
        ...productionOutput,
        rollupOptions: {
          input: {
            index: path.resolve(__dirname, 'src/main/index.ts'),
            'model-worker': path.resolve(__dirname, 'src/main/model-worker-entry.ts'),
          },
          output: { entryFileNames: '[name].js' },
        },
      },
    },
    preload: {
      resolve: { alias: sourceAlias },
      plugins: [requireStandalonePreloadEntries()],
      build: {
        ...productionOutput,
        externalizeDeps: false,
        rollupOptions: {
          input: {
            index: path.resolve(__dirname, 'src/preload/index.ts'),
            'image-decoder': path.resolve(__dirname, 'src/preload/image-decoder.ts'),
          },
          output: { entryFileNames: '[name].js' },
        },
      },
    },
    renderer: {
      root: path.resolve(__dirname, 'src/renderer'),
      resolve: { alias: sourceAlias },
      plugins: [react(), tailwindcss()],
      server: { host: '127.0.0.1' },
      build: { ...productionOutput },
    },
  };
});

import { builtinModules } from 'node:module';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import MagicString from 'magic-string';
import type { Plugin } from 'vite';

const sourceAlias = { '@': path.resolve(__dirname, 'src') };
const rendererDevPort = Number.parseInt(process.env.AIY_RENDERER_DEV_PORT ?? '5173', 10);
const rendererApplicationChunkBudgetBytes = 500_000;
const rendererVendorChunkWarningLimitKilobytes = 700;
const allowedMainRuntimeExternals = new Set([
  ...builtinModules,
  ...builtinModules.map((id) => `node:${id}`),
  'better-sqlite3',
  'electron',
]);

function applyElectronRollupOptions(): Plugin {
  return {
    name: 'aiy-electron-rolldown-options',
    enforce: 'post',
    config(config) {
      // electron-vite 5 presets still update the Rollup compatibility field.
      if (config.build?.rollupOptions) config.build.rolldownOptions = config.build.rollupOptions;
    },
  };
}

function preserveVFileNodeInterop(): Plugin {
  return {
    name: 'aiy-vfile-node-interop',
    transform: {
      filter: { id: /[/\\]vfile[/\\]lib[/\\]min(proc|path)\.js$/ },
      handler(code) {
        // Rolldown beta.53 drops the CJS default-import adapter when these
        // re-export-only modules are tree-shaken (process.default is undefined).
        return { code, moduleSideEffects: 'no-treeshake' };
      },
    },
  };
}

function supportPreloadDocumentDetection(): Plugin {
  return {
    name: 'aiy-preload-document-detection',
    transform: {
      filter: { id: /[/\\]prosemirror-view[/\\]dist[/\\]index\.(?:c?js)$/ },
      handler(code, id) {
        // Shared content schemas use Tiptap's serializer. In an Electron
        // preload, document exists before documentElement has been created.
        const lookup = 'doc.documentElement.style';
        const index = code.indexOf(lookup);
        if (index < 0 || code.indexOf(lookup, index + lookup.length) >= 0) {
          this.error('ProseMirror document detection changed; review the preload compatibility adapter.');
        }
        const output = new MagicString(code);
        output.overwrite(index, index + lookup.length, '(doc.documentElement?.style ?? {})');
        return { code: output.toString(), map: output.generateMap({ source: id, hires: true }) };
      },
    },
  };
}

function enforceMainRuntimeDependencyBoundary(): Plugin {
  return {
    name: 'aiy-main-runtime-dependency-boundary',
    generateBundle(_options, bundle) {
      const unexpectedExternals = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const dependencyId of [...output.imports, ...output.dynamicImports]) {
          if (
            !(dependencyId in bundle) &&
            !dependencyId.startsWith('.') &&
            !allowedMainRuntimeExternals.has(dependencyId)
          ) {
            unexpectedExternals.add(dependencyId);
          }
        }
      }
      if (unexpectedExternals.size) {
        this.error(
          `Main build contains undeclared runtime dependencies: ${[...unexpectedExternals].sort().join(', ')}. ` +
            'Bundle pure JavaScript dependencies or explicitly add the required native runtime files to electron-builder.yml.',
        );
      }
    },
  };
}

function rendererManualChunk(id: string) {
  const normalizedId = id.replaceAll('\\', '/');
  if (normalizedId.includes('/src/renderer/components/workspace/')) return 'workspace-runtime';
  if (
    normalizedId.includes('/node_modules/react/') ||
    normalizedId.includes('/node_modules/react-dom/') ||
    normalizedId.includes('/node_modules/scheduler/') ||
    normalizedId.includes('/node_modules/use-sync-external-store/')
  ) {
    return 'react-runtime';
  }
  if (normalizedId.endsWith('/src/renderer/i18n/locales/en.ts')) return 'english-catalog';
  // Shared icons must not pull the workspace chunk into lightweight petal windows.
  if (normalizedId.includes('/node_modules/lucide-react/')) return 'icons';
  if (normalizedId.includes('/node_modules/tailwind-merge/')) return 'tailwind-merge';
  if (normalizedId.includes('/node_modules/zod/')) return 'schema-runtime';
  if (normalizedId.includes('/node_modules/re2js/')) return 'rich-text-regex';
  return undefined;
}

function enforceRendererApplicationChunkBudget(): Plugin {
  const sourceDirectory = path.resolve(__dirname, 'src').replaceAll('\\', '/');
  return {
    name: 'aiy-renderer-application-chunk-budget',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        const bytes = Buffer.byteLength(output.code);
        if (bytes <= rendererApplicationChunkBudgetBytes) continue;
        const applicationModules = Object.entries(output.modules)
          .filter(([id]) => id.replaceAll('\\', '/').startsWith(`${sourceDirectory}/`))
          .sort(([, left], [, right]) => right.renderedLength - left.renderedLength);
        if (!applicationModules.length) continue;
        const largestModules = applicationModules
          .slice(0, 5)
          .map(([id]) => path.relative(__dirname, id).replaceAll('\\', '/'))
          .join(', ');
        this.error(
          `Renderer application chunk ${output.fileName} is ${(bytes / 1_000).toFixed(2)} kB; ` +
            `the limit is ${rendererApplicationChunkBudgetBytes / 1_000} kB. Largest application modules: ${largestModules}`,
        );
      }
    },
  };
}

function supportNonInteractiveIsolatedEntryBuilds() {
  // electron-vite 5.0.0's isolated-entry reporter assumes stdout is a TTY.
  // Keep redirected and CI builds working until its non-TTY fix is released.
  if (typeof process.stdout.clearLine !== 'function') process.stdout.clearLine = () => false;
  if (typeof process.stdout.cursorTo !== 'function') process.stdout.cursorTo = () => false;
  if (typeof process.stdout.moveCursor !== 'function') process.stdout.moveCursor = () => false;
}

supportNonInteractiveIsolatedEntryBuilds();

function requireStandalonePreloadEntries(): Plugin {
  const expectedEntries = new Set([
    'index.js',
    'image-decoder.js',
    'desktop-petals.js',
    'gif-renderer.js',
    'tray-menu.js',
  ]);
  return {
    name: 'aiy-require-standalone-preload-entries',
    generateBundle(_options, bundle) {
      const entryFiles = new Set<string>();
      const isolatedEntryAssets = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type === 'asset') {
          if (output.fileName.endsWith('.js')) isolatedEntryAssets.add(output.fileName);
          continue;
        }
        if (output.type !== 'chunk') continue;
        if (!output.isEntry) this.error(`Sandboxed preload build created shared chunk ${output.fileName}`);
        if (!expectedEntries.has(output.fileName)) this.error(`Unexpected sandboxed preload entry ${output.fileName}`);
        entryFiles.add(output.fileName);
        const bundledImports = [...output.imports, ...output.dynamicImports].filter((id) => id !== 'electron');
        if (bundledImports.length) {
          this.error(`Sandboxed preload ${output.fileName} imports ${bundledImports.join(', ')}`);
        }
      }

      // electron-vite validates each isolated entry as a chunk, then emits the final
      // standalone JavaScript files as assets from a small orchestration build.
      if (
        !entryFiles.size &&
        (isolatedEntryAssets.size !== expectedEntries.size ||
          [...expectedEntries].some((entry) => !isolatedEntryAssets.has(entry)))
      ) {
        this.error(`Unexpected sandboxed preload entries: ${[...isolatedEntryAssets].join(', ')}`);
      }
    },
  };
}

function reloadRendererForLanguageCatalog(): Plugin {
  const catalogDirectory = path.resolve(__dirname, 'extensions');
  return {
    name: 'aiy-reload-renderer-language-catalog',
    configureServer(server) {
      server.watcher.add(catalogDirectory);
      const reload = (changedPath: string) => {
        const resolved = path.resolve(changedPath);
        if (!resolved.startsWith(`${catalogDirectory}${path.sep}`)) return;
        if (path.basename(resolved) !== 'messages.json' && path.basename(resolved) !== 'manifest.json') return;
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('change', reload);
      server.httpServer?.once('close', () => server.watcher.off('change', reload));
    },
  };
}

export default defineConfig(({ command }) => {
  const productionBuild = command === 'build';
  const productionOutput = {
    minify: productionBuild ? ('oxc' as const) : false,
    sourcemap: !productionBuild,
  };

  return {
    main: {
      resolve: { alias: sourceAlias },
      plugins: [applyElectronRollupOptions(), preserveVFileNodeInterop(), enforceMainRuntimeDependencyBoundary()],
      build: {
        ...productionOutput,
        // Package pure JavaScript dependencies; only the native SQLite loader ships separately.
        externalizeDeps: false,
        rollupOptions: {
          external: ['better-sqlite3'],
          input: {
            index: path.resolve(__dirname, 'src/main/index.ts'),
            'agent-cli': path.resolve(__dirname, 'src/main/agent-cli-entry.ts'),
            'model-worker': path.resolve(__dirname, 'src/main/model-worker-entry.ts'),
          },
          output: { entryFileNames: '[name].js' },
        },
      },
    },
    preload: {
      resolve: { alias: sourceAlias },
      plugins: [applyElectronRollupOptions(), supportPreloadDocumentDetection(), requireStandalonePreloadEntries()],
      build: {
        ...productionOutput,
        externalizeDeps: false,
        isolatedEntries: true,
        rollupOptions: {
          input: {
            index: path.resolve(__dirname, 'src/preload/index.ts'),
            'image-decoder': path.resolve(__dirname, 'src/preload/image-decoder.ts'),
            'gif-renderer': path.resolve(__dirname, 'src/preload/gif-renderer.ts'),
            'desktop-petals': path.resolve(__dirname, 'src/preload/desktop-petals.ts'),
            'tray-menu': path.resolve(__dirname, 'src/preload/tray-menu.ts'),
          },
          output: { entryFileNames: '[name].js' },
        },
      },
    },
    renderer: {
      root: path.resolve(__dirname, 'src/renderer'),
      resolve: { alias: sourceAlias },
      plugins: [
        react(),
        tailwindcss(),
        applyElectronRollupOptions(),
        reloadRendererForLanguageCatalog(),
        enforceRendererApplicationChunkBudget(),
      ],
      server: { host: '127.0.0.1', port: rendererDevPort },
      build: {
        ...productionOutput,
        chunkSizeWarningLimit: rendererVendorChunkWarningLimitKilobytes,
        rollupOptions: {
          // HTML entries mount their own React root. Shared components must never
          // import an entry and run another window's bootstrap as a side effect.
          preserveEntrySignatures: 'strict',
          input: {
            index: path.resolve(__dirname, 'src/renderer/index.html'),
            petals: path.resolve(__dirname, 'src/renderer/petals.html'),
            'demo-petals': path.resolve(__dirname, 'src/renderer/demo-petals.html'),
            'tray-menu': path.resolve(__dirname, 'src/renderer/tray-menu.html'),
          },
          output: { manualChunks: rendererManualChunk },
        },
      },
    },
  };
});

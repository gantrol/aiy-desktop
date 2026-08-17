import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(projectRoot, 'src') },
  },
  test: {
    environment: 'node',
    include: ['tests/smoke/**/*.smoke.test.ts'],
    clearMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
  },
});

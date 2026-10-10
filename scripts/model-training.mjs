import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, '.tmp', 'model-training-cli');
await mkdir(directory, { recursive: true });
const output = path.join(directory, `${randomUUID()}.mjs`);
try {
  await build({
    entryPoints: [path.join(root, 'src/main/model-training/cli.ts')],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    tsconfig: path.join(root, 'tsconfig.json'),
    logLevel: 'silent',
    define: { __FURNACE_SOURCE_ROOT__: JSON.stringify(root) },
  });
  await (await import(pathToFileURL(output).href)).main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await rm(output, { force: true });
}

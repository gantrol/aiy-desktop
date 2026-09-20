import { build, createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const configFile = fileURLToPath(new URL('../design-lab/vite.config.ts', import.meta.url));
const command = process.argv[2] ?? 'dev';
if (command === 'build') {
  await build({ configFile });
} else if (command === 'dev') {
  const server = await createServer({ configFile });
  await server.listen();
  server.printUrls();
} else {
  throw new Error(`Unknown Design Lab command: ${command}`);
}

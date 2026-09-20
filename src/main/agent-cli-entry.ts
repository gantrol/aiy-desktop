import path from 'node:path';
import { runAgentCli } from '@/main/agent-cli/cli';

const appPath = path.resolve(__dirname, '..', '..');
const resourcesPath = appPath.endsWith('app.asar.unpacked') ? path.dirname(appPath) : appPath;

void runAgentCli(process.argv.slice(2), {
  appPath,
  resourcesPath: process.env.AIY_RESOURCES_PATH?.trim() || process.resourcesPath || resourcesPath,
}).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 5;
  },
);

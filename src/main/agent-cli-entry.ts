import path from 'node:path';
import { runAgentCli } from '@/main/agent-cli/cli';

const appPath = path.resolve(__dirname, '..', '..');

void runAgentCli(process.argv.slice(2), {
  appPath,
  resourcesPath: process.env.AIY_RESOURCES_PATH?.trim() || process.resourcesPath || appPath,
}).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 5;
  },
);

import { app } from 'electron';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import type { LibraryDatabase } from '@/main/database';
import { assertAgentContentTarget } from '@/main/agent/content-read';
import {
  agentContentLinkResultSchema,
  agentContentUrl,
  type AgentContentTarget,
} from '@/shared/contracts/agent-content';

/** Return structured argv so clipboard instructions never interpolate content into a shell command. */
export async function createAgentContentLink(database: LibraryDatabase, target: AgentContentTarget) {
  assertAgentContentTarget(database, target);
  const appPath = app.getAppPath();
  const cliRoot = appPath.endsWith('.asar') ? `${appPath}.unpacked` : appPath;
  const cliPath = path.join(cliRoot, 'out', 'main', 'agent-cli.js');
  const stats = await lstat(cliPath).catch(() => null);
  if (!stats?.isFile() || stats.isSymbolicLink()) throw new Error('AIY_AGENT_CLI_UNAVAILABLE');
  const url = agentContentUrl(target);
  return agentContentLinkResultSchema.parse({
    url,
    executable: 'node',
    args: [cliPath, 'content', 'read', '--input', '-', '--user-data-dir', app.getPath('userData')],
    input: { protocolVersion: 1, url },
  });
}

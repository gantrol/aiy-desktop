import type { LibraryDatabase } from '@/main/database';
import {
  agentPermissionsSchema,
  deniedAgentPermissions,
  type AgentPermission,
  type AgentPermissions,
} from '@/shared/contracts/agent-permissions';

const key = 'agent_cli_permissions_v1';
const failure = (code: string) => Object.assign(new Error(code), { code });

export function readAgentPermissions(database: LibraryDatabase): AgentPermissions {
  const spaceId = database.db.prepare('SELECT id FROM local_spaces WHERE singleton_key=1').pluck().get();
  if (typeof spaceId !== 'string' || !spaceId) throw failure('AIY_AGENT_PERMISSIONS_UNAVAILABLE');
  const raw = database.db.prepare('SELECT value FROM app_meta WHERE key=?').pluck().get(key);
  if (raw === undefined) return { spaceId, revision: 0, grants: deniedAgentPermissions() };
  try {
    const value = agentPermissionsSchema.parse(JSON.parse(String(raw)));
    if (value.spaceId !== spaceId) throw failure('AIY_AGENT_SPACE_CHANGED');
    return value;
  } catch {
    // A corrupt or foreign-space policy never falls back to a writable empty policy.
    throw failure('AIY_AGENT_PERMISSIONS_UNAVAILABLE');
  }
}

export function saveAgentPermissions(database: LibraryDatabase, raw: unknown) {
  const input = agentPermissionsSchema.parse(raw);
  return database.db.transaction(() => {
    const current = readAgentPermissions(database);
    if (current.spaceId !== input.spaceId) throw failure('AIY_AGENT_SPACE_CHANGED');
    if (current.revision !== input.revision) throw failure('AIY_AGENT_PERMISSIONS_CONFLICT');
    const next = { ...input, revision: current.revision + 1 };
    database.db
      .prepare('INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, JSON.stringify(next));
    return next;
  })();
}

const required: Record<string, AgentPermission[]> = {
  'agent.file-view.refresh': ['writeContent'],
  'agent.content.read': ['readContent'],
  'agent.content.search': ['readContent'],
  'agent.album.list': ['readContent'],
  'agent.intake.get': ['readContent'],
  'agent.job.get': ['readContent'],
  'agent.pack.preview': ['readContent'],
  'agent.work.list': ['readContent'],
  'agent.work.read': ['readContent'],
  'agent.creation.albums': ['readContent'],
  'agent.creation.ensure-album': ['writeContent'],
  'agent.creation.move': ['writeContent'],
  'agent.content.update': ['writeContent'],
  'agent.album.ensure': ['writeContent'],
  'agent.album.add': ['writeContent'],
  'agent.album.remove': ['writeContent'],
  'agent.intake.import': ['writeContent'],
  'agent.asset.import': ['writeContent'],
  'agent.pack.apply': ['writeContent'],
  'agent.work.mutate': ['manageWork'],
  'agent.draft.prepare': ['generate'],
  'agent.generation.start': ['generate'],
  'agent.job.cancel': ['generate'],
  'agent.action.authorize': ['externalActions'],
};
export function requireAgentPermission(database: LibraryDatabase, method: string) {
  if (method === 'agent.permissions.read') return;
  const permissions = required[method];
  if (!permissions) throw failure('AIY_AGENT_PERMISSION_DENIED');
  const policy = readAgentPermissions(database);
  const denied = permissions.filter((permission) => !policy.grants[permission]);
  if (denied.length)
    throw Object.assign(new Error(`Enable CLI permissions in Settings > CLI: ${denied.join(', ')}`), {
      code: 'AIY_AGENT_PERMISSION_DENIED',
    });
}

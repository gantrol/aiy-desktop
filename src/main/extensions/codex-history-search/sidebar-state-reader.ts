import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { z } from 'zod';

const MAX_GLOBAL_STATE_BYTES = 32 * 1024 * 1024;
const MAX_PROJECTS = 10_000;
const MAX_THREADS = 100_000;
const MAX_SECTIONS = 1_000;
const MAX_SECTION_ITEMS = 100_000;

const identitySchema = z.string().trim().min(1).max(512);
const sidebarItemKeySchema = z.string().trim().min(1).max(1_024);
const identityListSchema = z.array(identitySchema).max(MAX_THREADS);
const sidebarItemListSchema = z.array(sidebarItemKeySchema).max(MAX_SECTION_ITEMS);
const localProjectSchema = z
  .object({
    id: identitySchema,
    name: z.string().trim().min(1).max(500),
    rootPaths: z.array(z.string().max(32_768)).max(100),
  })
  .passthrough();
const threadProjectAssignmentSchema = z
  .object({
    projectKind: z.string().trim().min(1).max(64),
    projectId: identitySchema,
  })
  .passthrough();
const customSectionSchema = z
  .object({
    id: identitySchema,
    name: z.string().trim().min(1).max(500),
    hostSectionIds: z.record(z.string().trim().min(1).max(200), identitySchema),
    itemKeys: sidebarItemListSchema,
  })
  .passthrough();
const customSectionAccountSchema = z
  .object({
    sections: z.array(customSectionSchema).max(MAX_SECTIONS),
    sectionOrder: z.array(sidebarItemKeySchema).max(MAX_SECTIONS),
  })
  .passthrough();
const persistedAtomStateSchema = z.record(z.string().min(1).max(1_024), z.unknown());
const globalStateSchema = z
  .object({
    'electron-persisted-atom-state': persistedAtomStateSchema.optional(),
    'local-projects': z.record(identitySchema, localProjectSchema).optional(),
    'project-order': z.array(identitySchema).max(MAX_PROJECTS).optional(),
    'thread-project-assignments': z.record(identitySchema, threadProjectAssignmentSchema).optional(),
    'pinned-project-ids': z.array(identitySchema).max(MAX_PROJECTS).optional(),
    'pinned-thread-ids': identityListSchema.optional(),
    'app-server-project-id-by-legacy-project-id-by-host': z
      .record(z.string().trim().min(1).max(32_768), z.record(identitySchema, identitySchema))
      .optional(),
  })
  .passthrough();
const customSectionAccountsSchema = z.record(identitySchema, customSectionAccountSchema);

interface SidebarPlacement {
  sectionId: string;
  position: number;
}

export interface CodexSidebarProject {
  projectId: string;
  name: string;
  rootPaths: string[];
  position: number;
  sectionId: string;
  sectionPosition: number | null;
}

export interface CodexSidebarSection {
  sectionId: string;
  name: string;
  position: number;
}

export interface CodexSidebarState {
  projects: CodexSidebarProject[];
  sections: CodexSidebarSection[];
  projectIdByLegacyProjectId: Map<string, string>;
  projectIdByThreadId: Map<string, string>;
  placementByThreadId: Map<string, SidebarPlacement>;
  sectionIdByLegacySectionId: Map<string, string>;
  signature: string;
}

function isMissingFile(reason: unknown) {
  return (reason as { code?: unknown } | null)?.code === 'ENOENT';
}

function parsedThreadItemKey(itemKey: string) {
  const match = /^codex:thread:local:(.+)$/.exec(itemKey);
  return match?.[1]?.trim().toLowerCase() || null;
}

function parsedProjectItemKey(itemKey: string) {
  const match = /^codex:project:(.+)$/.exec(itemKey);
  return match?.[1]?.trim() || null;
}

function selectedCustomSectionAccount(value: unknown) {
  if (value === undefined) return null;
  const parsed = customSectionAccountsSchema.safeParse(value);
  if (!parsed.success) throw new Error('Codex sidebar sections have an unsupported shape');
  const accounts = Object.entries(parsed.data);
  if (accounts.length > MAX_SECTIONS) throw new Error('Codex sidebar section accounts exceed the local limit');
  return (
    accounts
      .map(([accountId, state]) => ({
        accountId,
        state,
        localSections: state.sections.filter(({ hostSectionIds }) => Boolean(hostSectionIds.local)).length,
      }))
      .sort(
        (left, right) =>
          right.localSections - left.localSections ||
          right.state.sections.length - left.state.sections.length ||
          left.accountId.localeCompare(right.accountId),
      )[0]?.state ?? null
  );
}

function orderedUnique(values: readonly string[]) {
  return [...new Set(values)];
}

function normalizedSignature(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(value) ?? 'null')
    .digest('hex');
}

type ParsedGlobalState = z.infer<typeof globalStateSchema>;
type ProjectEntry = [string, z.infer<typeof localProjectSchema>];

async function readGlobalStateFile(globalStatePath: string, signal: AbortSignal) {
  let metadata;
  try {
    metadata = await lstat(globalStatePath);
  } catch (reason) {
    if (isMissingFile(reason)) return null;
    throw reason;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('Codex sidebar state is not a regular file');
  }
  if (metadata.size > MAX_GLOBAL_STATE_BYTES) throw new Error('Codex sidebar state exceeds the local size limit');
  signal.throwIfAborted();
  const source = await readFile(globalStatePath, { encoding: 'utf8', signal });
  if (Buffer.byteLength(source, 'utf8') > MAX_GLOBAL_STATE_BYTES) {
    throw new Error('Codex sidebar state exceeds the local size limit');
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(source) as unknown;
  } catch {
    throw new Error('Codex sidebar state JSON is malformed');
  }
  const parsed = globalStateSchema.safeParse(decoded);
  if (!parsed.success) throw new Error('Codex sidebar state has an unsupported shape');
  return parsed.data;
}

function readProjectCatalog(state: ParsedGlobalState) {
  const entries = Object.entries(state['local-projects'] ?? {}) as ProjectEntry[];
  if (entries.length > MAX_PROJECTS) throw new Error('Codex sidebar projects exceed the local limit');
  for (const [projectId, project] of entries) {
    if (project.id !== projectId) throw new Error('Codex sidebar project identity is inconsistent');
  }
  const ids = new Set(entries.map(([projectId]) => projectId));
  const order = orderedUnique(state['project-order'] ?? []).filter((projectId) => ids.has(projectId));
  const positionById = new Map(order.map((projectId, position) => [projectId, position]));
  let nextPosition = order.length;
  for (const [projectId] of entries) {
    if (!positionById.has(projectId)) positionById.set(projectId, nextPosition++);
  }
  return { entries, ids, positionById };
}

function readCustomNavigation(atomState: Record<string, unknown>, projectIds: ReadonlySet<string>) {
  const account = selectedCustomSectionAccount(atomState['sidebar-custom-sections-v3']);
  const sectionOrder = new Map(
    (account?.sectionOrder ?? []).flatMap((itemKey, position) => {
      const match = /^custom:(.+)$/.exec(itemKey);
      return match?.[1] ? [[match[1], position] as const] : [];
    }),
  );
  const customSections = [...(account?.sections ?? [])].sort(
    (left, right) =>
      (sectionOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (sectionOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id),
  );
  const placementByThreadId = new Map<string, SidebarPlacement>();
  const placementByProjectId = new Map<string, SidebarPlacement>();
  const sectionIdByLegacySectionId = new Map<string, string>();
  const sections: CodexSidebarSection[] = [];
  customSections.forEach((section, sectionOffset) => {
    sections.push({ sectionId: section.id, name: section.name, position: sectionOffset + 1 });
    const legacySectionId = section.hostSectionIds.local;
    if (legacySectionId) sectionIdByLegacySectionId.set(legacySectionId, section.id);
    section.itemKeys.forEach((itemKey, position) => {
      const threadId = parsedThreadItemKey(itemKey);
      if (threadId) placementByThreadId.set(threadId, { sectionId: section.id, position });
      const projectId = parsedProjectItemKey(itemKey);
      if (projectId && projectIds.has(projectId)) {
        placementByProjectId.set(projectId, { sectionId: section.id, position });
      }
    });
  });
  return { placementByThreadId, placementByProjectId, sectionIdByLegacySectionId, sections };
}

function applyPinnedNavigation(
  state: ParsedGlobalState,
  atomState: Record<string, unknown>,
  projectIds: ReadonlySet<string>,
  navigation: ReturnType<typeof readCustomNavigation>,
) {
  const pinnedProjectIds = orderedUnique(state['pinned-project-ids'] ?? []).filter((projectId) =>
    projectIds.has(projectId),
  );
  const pinnedThreadIds = orderedUnique(
    z
      .array(identitySchema)
      .max(MAX_THREADS)
      .parse(atomState['app-server-pinned-thread-order-v1'] ?? state['pinned-thread-ids'] ?? []),
  ).map((threadId) => threadId.toLowerCase());
  const unifiedPinnedItems = z
    .array(sidebarItemKeySchema)
    .max(MAX_SECTION_ITEMS)
    .parse(atomState['unified-sidebar-pinned-order-v1'] ?? []);
  const unifiedPosition = new Map<string, number>();
  unifiedPinnedItems.forEach((itemKey, position) => unifiedPosition.set(itemKey, position));
  const pinnedItems = [
    ...pinnedThreadIds.map((threadId, fallbackPosition) => ({
      itemKey: `codex:thread:local:${threadId}`,
      kind: 'thread' as const,
      id: threadId,
      fallbackPosition,
    })),
    ...pinnedProjectIds.map((projectId, fallbackPosition) => ({
      itemKey: `codex:project:${projectId}`,
      kind: 'project' as const,
      id: projectId,
      fallbackPosition: pinnedThreadIds.length + fallbackPosition,
    })),
  ].sort(
    (left, right) =>
      (unifiedPosition.get(left.itemKey) ?? MAX_SECTION_ITEMS + left.fallbackPosition) -
      (unifiedPosition.get(right.itemKey) ?? MAX_SECTION_ITEMS + right.fallbackPosition),
  );
  if (pinnedItems.length) navigation.sections.unshift({ sectionId: 'pinned', name: 'Pinned', position: 0 });
  pinnedItems.forEach((item, position) => {
    const placements = item.kind === 'thread' ? navigation.placementByThreadId : navigation.placementByProjectId;
    if (!placements.has(item.id)) placements.set(item.id, { sectionId: 'pinned', position });
  });
}

function readProjectAssignments(state: ParsedGlobalState, projectIds: ReadonlySet<string>) {
  const assignments = Object.entries(state['thread-project-assignments'] ?? {});
  if (assignments.length > MAX_THREADS) throw new Error('Codex sidebar task assignments exceed the local limit');
  const projectIdByThreadId = new Map<string, string>();
  for (const [threadId, assignment] of assignments) {
    if (assignment.projectKind === 'local' && projectIds.has(assignment.projectId)) {
      projectIdByThreadId.set(threadId.toLowerCase(), assignment.projectId);
    }
  }
  return projectIdByThreadId;
}

function readLegacyProjectMappings(state: ParsedGlobalState, projectIds: ReadonlySet<string>) {
  const mappings = new Map<string, string>();
  for (const projectMap of Object.values(state['app-server-project-id-by-legacy-project-id-by-host'] ?? {})) {
    for (const [projectId, legacyProjectId] of Object.entries(projectMap)) {
      if (projectIds.has(projectId)) mappings.set(legacyProjectId, projectId);
    }
  }
  return mappings;
}

export async function readCodexSidebarState(
  globalStatePath: string | null,
  signal: AbortSignal,
): Promise<CodexSidebarState | null> {
  if (!globalStatePath) return null;
  const state = await readGlobalStateFile(globalStatePath, signal);
  if (!state) return null;
  if (state['local-projects'] === undefined) return null;
  const projectCatalog = readProjectCatalog(state);
  const atomState = state['electron-persisted-atom-state'] ?? {};
  const navigation = readCustomNavigation(atomState, projectCatalog.ids);
  applyPinnedNavigation(state, atomState, projectCatalog.ids, navigation);
  const projectIdByThreadId = readProjectAssignments(state, projectCatalog.ids);
  const projectIdByLegacyProjectId = readLegacyProjectMappings(state, projectCatalog.ids);
  const projects = projectCatalog.entries
    .map(([projectId, project]): CodexSidebarProject => {
      const placement = navigation.placementByProjectId.get(projectId);
      return {
        projectId,
        name: project.name,
        rootPaths: project.rootPaths,
        position: projectCatalog.positionById.get(projectId) ?? Number.MAX_SAFE_INTEGER,
        sectionId: placement?.sectionId ?? '',
        sectionPosition: placement?.position ?? null,
      };
    })
    .sort((left, right) => left.position - right.position || left.projectId.localeCompare(right.projectId));
  const signatureValue = {
    projects,
    sections: navigation.sections,
    projectIdByLegacyProjectId: [...projectIdByLegacyProjectId].sort(([left], [right]) => left.localeCompare(right)),
    projectIdByThreadId: [...projectIdByThreadId].sort(([left], [right]) => left.localeCompare(right)),
    placementByThreadId: [...navigation.placementByThreadId].sort(([left], [right]) => left.localeCompare(right)),
    sectionIdByLegacySectionId: [...navigation.sectionIdByLegacySectionId].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  };
  return {
    projects,
    sections: navigation.sections,
    projectIdByLegacyProjectId,
    projectIdByThreadId,
    placementByThreadId: navigation.placementByThreadId,
    sectionIdByLegacySectionId: navigation.sectionIdByLegacySectionId,
    signature: normalizedSignature(signatureValue),
  };
}

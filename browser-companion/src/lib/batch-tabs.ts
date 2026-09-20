import { z } from 'zod';
import { companionSiteSchema, handoffIdFromUrl, resolveSiteFromUrl, type CompanionSite } from '@/lib/protocol';

const TAB_KEY_PREFIX = 'aiy-companion-tab-handoff:';
const GROUPS_KEY = 'aiy-companion-batch-groups-v1';
const MAX_GROUPS = 64;
const bindingSchema = z.object({ handoffId: z.string().uuid(), target: companionSiteSchema }).strict();
const groupSchema = z
  .object({
    groupId: z.number().int().nonnegative(),
    windowId: z.number().int(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
const groupsSchema = z.record(z.string().uuid(), groupSchema);
let pendingGroupOperation: Promise<unknown> = Promise.resolve();

export async function handoffForTab(tabId: number, target: CompanionSite): Promise<string | null> {
  const key = `${TAB_KEY_PREFIX}${tabId}`;
  const stored = await browser.storage.session.get(key).catch(() => ({}));
  const binding = bindingSchema.safeParse(Reflect.get(stored, key));
  return binding.success && binding.data.target === target ? binding.data.handoffId : null;
}

export async function forgetHandoffTab(tabId: number): Promise<void> {
  await browser.storage.session.remove(`${TAB_KEY_PREFIX}${tabId}`);
}

async function groupBatchTab(tabId: number, windowId: number, batchId: string, title: string): Promise<void> {
  // Optional permission: connection and filling still work when grouping is declined.
  if (!(await browser.permissions.contains({ permissions: ['tabGroups'] }))) return;
  const stored = await browser.storage.session.get(GROUPS_KEY);
  const groups = groupsSchema.safeParse(stored[GROUPS_KEY]).data ?? {};
  const previous = groups[batchId];
  const existing = previous ? await browser.tabGroups.get(previous.groupId).catch(() => null) : null;
  let groupId: number;
  if (existing) {
    // Only move the new, explicitly handed-off tab. Existing user tabs never enter this path.
    if (existing.windowId !== windowId) await browser.tabs.move(tabId, { windowId: existing.windowId, index: -1 });
    groupId = await browser.tabs.group({ tabIds: [tabId], groupId: existing.id });
    windowId = existing.windowId;
  } else {
    groupId = await browser.tabs.group({ tabIds: [tabId], createProperties: { windowId } });
  }
  groups[batchId] = { groupId, windowId, createdAt: previous?.createdAt ?? Date.now() };
  const entries = Object.entries(groups).sort((left, right) => right[1].createdAt - left[1].createdAt);
  await browser.storage.session.set({ [GROUPS_KEY]: Object.fromEntries(entries.slice(0, MAX_GROUPS)) });
  await browser.tabGroups.update(groupId, { title: `AIY · ${title}`.slice(0, 80), color: 'pink', collapsed: false });
}

/** Called only after the existing localhost bootstrap has authenticated its sender. */
export async function registerHandoffTab(tabId: number, windowId: number, destination: string): Promise<void> {
  const handoffId = handoffIdFromUrl(destination);
  const target = resolveSiteFromUrl(destination);
  if (!handoffId || !target) return;
  await browser.storage.session.set({ [`${TAB_KEY_PREFIX}${tabId}`]: { handoffId, target } });
  const fragment = new URLSearchParams(new URL(destination).hash.slice(1));
  const batchId = z.string().uuid().safeParse(fragment.get('aiy-batch')).data;
  if (!batchId || target === 'chatgpt') return;
  const title = (fragment.get('aiy-batch-title') ?? 'AIY').trim().slice(0, 80) || 'AIY';
  const operation = pendingGroupOperation.then(() => groupBatchTab(tabId, windowId, batchId, title));
  pendingGroupOperation = operation.catch(() => undefined);
  await operation.catch(() => undefined);
}

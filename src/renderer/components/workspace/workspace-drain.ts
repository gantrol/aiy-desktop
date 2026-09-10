const drains = new Set<() => Promise<void>>();

export function registerWorkspaceDrain(drain: () => Promise<void>) {
  drains.add(drain);
  return () => {
    drains.delete(drain);
  };
}

export async function flushWorkspaceNavigation() {
  const results = await Promise.allSettled([...drains].map((drain) => drain()));
  return results.every((result) => result.status === 'fulfilled');
}

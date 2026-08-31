import type { ProviderConnectionDto } from '@/shared/contracts';

export async function loadProviderConnection(connectionId: string): Promise<ProviderConnectionDto> {
  const connections = await window.desktopApi.providerConnectionsList();
  const connection = connections.find((candidate) => candidate.connectionId === connectionId);
  if (!connection) throw new Error(`Provider connection is unavailable: ${connectionId}`);
  return connection;
}

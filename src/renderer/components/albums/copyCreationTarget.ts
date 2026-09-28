import type { CreationOutlineTarget } from '@/shared/contracts/creation-outline';

export async function copyCreationTarget(kind: CreationOutlineTarget['kind'], id: string, albumId: string | null) {
  const result = await window.desktopApi.creationOutlineCommand({ kind: 'copy', targets: [{ kind, id }], albumId });
  if (result.kind === 'error') throw new Error(result.code);
  return result;
}

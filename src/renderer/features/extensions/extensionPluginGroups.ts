import type { ExtensionDto } from '@/shared/contracts';

export type ExtensionPluginGroup = 'models' | 'features' | 'languages';

export const extensionPluginGroupOrder: readonly ExtensionPluginGroup[] = ['models', 'features', 'languages'];

export function extensionPluginGroup(extension: ExtensionDto): ExtensionPluginGroup {
  if (extension.manifest.kind === 'LANGUAGE') return 'languages';
  if ((extension.manifest.contributes.modelProviders?.length ?? 0) > 0) return 'models';
  return 'features';
}

export function firstGroupedExtensionId(extensions: readonly ExtensionDto[]) {
  for (const group of extensionPluginGroupOrder) {
    const first = extensions.find((extension) => extensionPluginGroup(extension) === group);
    if (first) return first.manifest.id;
  }
  return '';
}

import type { ExtensionDto } from '@/shared/contracts';
import { CODEX_EXTENSION_ID } from '@/shared/extension-ids';

export type ExtensionPluginGroup = 'models' | 'frontendDesign' | 'features' | 'languages';

export const extensionPluginGroupOrder: readonly ExtensionPluginGroup[] = [
  'features',
  'frontendDesign',
  'languages',
  'models',
];

export function extensionPluginGroup(extension: ExtensionDto): ExtensionPluginGroup {
  if (extension.manifest.kind === 'LANGUAGE') return 'languages';
  if (extension.manifest.id === CODEX_EXTENSION_ID) return 'features';
  if ((extension.manifest.contributes.modelProviders?.length ?? 0) > 0) return 'models';
  if (extension.manifest.category === 'FRONTEND_DESIGN') return 'frontendDesign';
  return 'features';
}

export function firstGroupedExtensionId(extensions: readonly ExtensionDto[]) {
  for (const group of extensionPluginGroupOrder) {
    const first = extensions.find((extension) => extensionPluginGroup(extension) === group);
    if (first) return first.manifest.id;
  }
  return '';
}

import type { BootstrapDto, ExtensionDto } from '@/shared/contracts';
import {
  CODEX_EXTENSION_ID,
  FEATURE_DEMO_EXTENSION_ID,
  TRANSITION_SHOWCASE_EXTENSION_ID,
} from '@/shared/extension-ids';
import { CodexArtifactsScreen } from '@/renderer/features/extensions/CodexArtifactsScreen';
import { FeatureDemoShowcase } from '@/renderer/features/extensions/FeatureDemoShowcase';
import { TransitionShowcase } from '@/renderer/features/extensions/TransitionShowcase';

const featureExtensionIds = new Set<string>([
  CODEX_EXTENSION_ID,
  FEATURE_DEMO_EXTENSION_ID,
  TRANSITION_SHOWCASE_EXTENSION_ID,
]);

export function hasExtensionPluginFeature(extension: ExtensionDto) {
  return extension.enabled && featureExtensionIds.has(extension.manifest.id);
}

interface Props {
  active: boolean;
  data: BootstrapDto;
  dataRevision: number;
  extension: ExtensionDto;
  extensions: readonly ExtensionDto[];
  notify(message: string): void;
  onOpenCreation(seriesId: string, assetId: string | null): Promise<void>;
}

export function ExtensionPluginFeaturePage({
  active,
  data,
  dataRevision,
  extension,
  extensions,
  notify,
  onOpenCreation,
}: Props) {
  return (
    <div data-extension-plugin-feature className="grid gap-6">
      {extension.manifest.id === CODEX_EXTENSION_ID && (
        <div className="h-[min(72rem,calc(100vh-12rem))] min-h-[36rem] overflow-hidden border">
          <CodexArtifactsScreen active={active} extension={extension} notify={notify} onOpenCreation={onOpenCreation} />
        </div>
      )}
      {extension.manifest.id === TRANSITION_SHOWCASE_EXTENSION_ID && (
        <TransitionShowcase
          active={active}
          libraryKey={data.spaceName}
          dataRevision={dataRevision}
          terms={data.terms}
          facets={data.facets}
          notify={notify}
        />
      )}
      {extension.manifest.id === FEATURE_DEMO_EXTENSION_ID && (
        <FeatureDemoShowcase data={data} extensions={extensions} notify={notify} />
      )}
    </div>
  );
}

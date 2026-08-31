import type { BootstrapDto, ExtensionDto } from '@/shared/contracts';
import {
  CODEX_IMAGE_DISCOVERY_EXTENSION_ID,
  CODEX_HISTORY_SEARCH_EXTENSION_ID,
  CODEX_USAGE_INVESTIGATOR_EXTENSION_ID,
  CODEX_VISUALIZATION_DISCOVERY_EXTENSION_ID,
  FEATURE_DEMO_EXTENSION_ID,
  TRANSITION_SHOWCASE_EXTENSION_ID,
} from '@/shared/extension-ids';
import { CodexImageDiscoveryConfiguration } from '@/renderer/features/extensions/CodexImageDiscoveryConfiguration';
import { CodexHistorySearchConfiguration } from '@/renderer/features/extensions/CodexHistorySearchConfiguration';
import { CodexUsageInvestigatorConfiguration } from '@/renderer/features/extensions/CodexUsageInvestigatorConfiguration';
import { CodexVisualizationDiscoveryConfiguration } from '@/renderer/features/extensions/CodexVisualizationDiscoveryConfiguration';
import { FeatureDemoShowcase } from '@/renderer/features/extensions/FeatureDemoShowcase';
import { TransitionShowcase } from '@/renderer/features/extensions/TransitionShowcase';

const featureExtensionIds = new Set<string>([
  CODEX_IMAGE_DISCOVERY_EXTENSION_ID,
  CODEX_HISTORY_SEARCH_EXTENSION_ID,
  CODEX_USAGE_INVESTIGATOR_EXTENSION_ID,
  CODEX_VISUALIZATION_DISCOVERY_EXTENSION_ID,
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
      {extension.manifest.id === CODEX_IMAGE_DISCOVERY_EXTENSION_ID && (
        <CodexImageDiscoveryConfiguration
          active={active}
          extension={extension}
          notify={notify}
          onOpenCreation={onOpenCreation}
        />
      )}
      {extension.manifest.id === CODEX_HISTORY_SEARCH_EXTENSION_ID && (
        <CodexHistorySearchConfiguration active={active} extension={extension} notify={notify} />
      )}
      {extension.manifest.id === CODEX_VISUALIZATION_DISCOVERY_EXTENSION_ID && (
        <CodexVisualizationDiscoveryConfiguration active={active} extension={extension} notify={notify} />
      )}
      {extension.manifest.id === CODEX_USAGE_INVESTIGATOR_EXTENSION_ID && (
        <CodexUsageInvestigatorConfiguration active={active} extension={extension} notify={notify} />
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

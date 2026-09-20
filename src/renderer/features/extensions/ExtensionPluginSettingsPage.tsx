import { BlocksIcon } from 'lucide-react';
import type { ExtensionContributionPoint, ExtensionDto } from '@/shared/contracts';
import {
  ANTIGRAVITY_CLI_EXTENSION_ID,
  CODEX_EXTENSION_ID,
  CPA_IMAGE_API_EXTENSION_ID,
  DEEPSEEK_API_EXTENSION_ID,
  EXTERNAL_IMAGE_API_EXTENSION_IDS,
  NATURAL_WATERMARK_EXTENSION_ID,
  OPENAI_IMAGE_API_EXTENSION_ID,
  TRANSITION_SHOWCASE_EXTENSION_ID,
} from '@/shared/extension-ids';
import { EXTENSION_HOST_ENGINE_KEY } from '@/shared/product';
import { EXTENSION_PERMISSION } from '@/shared/extension-permissions';
import { Badge } from '@/renderer/components/ui/badge';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { AntigravityCliConfiguration } from '@/renderer/features/extensions/AntigravityCliConfiguration';
import { ArticleDeliveryConfiguration } from '@/renderer/features/extensions/ArticleDeliveryConfiguration';
import type { CodexImagesNavigationState } from '@/renderer/features/extensions/codexImageNavigation';
import { DeepSeekApiConfiguration } from '@/renderer/features/extensions/DeepSeekApiConfiguration';
import { ExternalImageApiConfiguration } from '@/renderer/features/extensions/ExternalImageApiConfiguration';
import { OpenAiImageApiConfiguration } from '@/renderer/features/extensions/OpenAiImageApiConfiguration';
import { OpenAiCostsConfiguration } from '@/renderer/features/extensions/OpenAiCostsConfiguration';
import { CpaImageApiConfiguration } from '@/renderer/features/extensions/CpaImageApiConfiguration';
import { NaturalWatermarkConfigurationPanel } from '@/renderer/features/extensions/NaturalWatermarkConfiguration';
import type { TransitionShowcaseNavigationState } from '@/renderer/features/extensions/transitionShowcaseNavigation';
import { useI18n } from '@/renderer/i18n/useI18n';

const externalImageApiExtensionIds = new Set<string>(EXTERNAL_IMAGE_API_EXTENSION_IDS);
const contributionOrder: ExtensionContributionPoint[] = [
  'contentApplications',
  'deliveryChannels',
  'modelProviders',
  'metricProviders',
  'tools',
  'workflows',
  'commands',
  'searchProviders',
  'filters',
  'fields',
  'themes',
];

interface Props {
  active: boolean;
  busyKey: string;
  extension: ExtensionDto;
  codexImagesNavigation: CodexImagesNavigationState;
  transitionShowcaseNavigation: TransitionShowcaseNavigationState;
  notify(message: string): void;
  onConnectionChanged(): void | Promise<void>;
}

function ExtensionNavigationPreference({
  busyKey,
  extension,
  codexImagesNavigation,
  transitionShowcaseNavigation,
}: Pick<Props, 'busyKey' | 'extension' | 'codexImagesNavigation' | 'transitionShowcaseNavigation'>) {
  const l = useI18n().messages.extensions;
  if (extension.manifest.id === CODEX_EXTENSION_ID) {
    return (
      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-lg border px-4 py-3 text-sm font-medium">
        <span>{l.codexArtifacts.actions.showInSidebar}</span>
        <Checkbox
          checked={codexImagesNavigation.enabled}
          disabled={!extension.enabled || Boolean(busyKey)}
          onCheckedChange={(checked) => codexImagesNavigation.setEnabled(checked === true)}
        />
      </label>
    );
  }
  if (extension.manifest.id === TRANSITION_SHOWCASE_EXTENSION_ID) {
    return (
      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-lg border px-4 py-3 text-sm font-medium">
        <span>{l.transitionShowcase.showInSidebar}</span>
        <Checkbox
          checked={transitionShowcaseNavigation.enabled}
          disabled={!extension.enabled || Boolean(busyKey)}
          onCheckedChange={(checked) => transitionShowcaseNavigation.setEnabled(checked === true)}
        />
      </label>
    );
  }
  return null;
}

export function ExtensionPluginSettingsPage({
  active,
  busyKey,
  extension,
  codexImagesNavigation,
  transitionShowcaseNavigation,
  notify,
  onConnectionChanged,
}: Props) {
  const messages = useI18n().messages;
  const l = messages.extensions;
  const naturalWatermark = extension.manifest.id === NATURAL_WATERMARK_EXTENSION_ID;
  return (
    <section data-extension-plugin-settings className="grid gap-6">
      {naturalWatermark && <NaturalWatermarkConfigurationPanel active={active && extension.enabled} notify={notify} />}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border text-sm sm:grid-cols-4">
        <div className="bg-background p-3">
          <dt className="text-xs text-muted-foreground">{l.fields.manifest}</dt>
          <dd className="mt-1 font-medium">{extension.manifest.manifestVersion}</dd>
        </div>
        <div className="bg-background p-3">
          <dt className="text-xs text-muted-foreground">{l.fields.engine}</dt>
          <dd className="mt-1 font-medium">{extension.manifest.engines[EXTENSION_HOST_ENGINE_KEY]}</dd>
        </div>
        <div className="bg-background p-3">
          <dt className="text-xs text-muted-foreground">{l.fields.source}</dt>
          <dd className="mt-1 font-medium">{l.source[extension.source]}</dd>
        </div>
        <div className="bg-background p-3">
          <dt className="text-xs text-muted-foreground">{l.fields.compatibility}</dt>
          <dd className="mt-1 font-medium">{extension.compatible ? l.compatible : l.incompatible}</dd>
        </div>
        {extension.manifest.runtime && (
          <div className="bg-background p-3">
            <dt className="text-xs text-muted-foreground">{l.fields.runtime}</dt>
            <dd className="mt-1 font-medium">{extension.manifest.runtime.id}</dd>
          </div>
        )}
      </dl>
      <ExtensionNavigationPreference
        busyKey={busyKey}
        extension={extension}
        codexImagesNavigation={codexImagesNavigation}
        transitionShowcaseNavigation={transitionShowcaseNavigation}
      />
      {extension.manifest.id === OPENAI_IMAGE_API_EXTENSION_ID && (
        <>
          <OpenAiImageApiConfiguration active={active} notify={notify} onConnectionChanged={onConnectionChanged} />
          <OpenAiCostsConfiguration
            active={
              active &&
              extension.enabled &&
              extension.compatible &&
              extension.permissions.some(
                (permission) => permission.key === EXTENSION_PERMISSION.accountReadOpenAiCosts && permission.granted,
              )
            }
          />
        </>
      )}
      {extension.manifest.id === CPA_IMAGE_API_EXTENSION_ID && (
        <CpaImageApiConfiguration active={active} notify={notify} onConnectionChanged={onConnectionChanged} />
      )}
      {extension.manifest.id === DEEPSEEK_API_EXTENSION_ID && (
        <DeepSeekApiConfiguration active={active} notify={notify} onConnectionChanged={onConnectionChanged} />
      )}
      {extension.manifest.id === ANTIGRAVITY_CLI_EXTENSION_ID && (
        <AntigravityCliConfiguration active={active && extension.enabled} onConnectionChanged={onConnectionChanged} />
      )}
      {extension.manifest.configuration?.kind === 'ARTICLE_DELIVERY' && (
        <ArticleDeliveryConfiguration
          active={active && extension.enabled}
          extension={extension}
          notify={notify}
          onConnectionChanged={onConnectionChanged}
        />
      )}
      {externalImageApiExtensionIds.has(extension.manifest.id) && (
        <ExternalImageApiConfiguration
          active={active}
          manifest={extension.manifest}
          notify={notify}
          onConnectionChanged={onConnectionChanged}
        />
      )}
      <div className="grid gap-5">
        <section className="rounded-lg border">
          <h3 className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold">
            <BlocksIcon className="size-4" />
            {l.sections.contributions}
          </h3>
          <div className="divide-y">
            {contributionOrder.flatMap((point) =>
              (extension.manifest.contributes[point] ?? []).map((contribution) => (
                <div key={`${point}:${contribution}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">{contribution}</span>
                  <Badge variant="outline">{l.contributionPoints[point]}</Badge>
                </div>
              )),
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

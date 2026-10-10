import type { BootstrapDto, ExtensionDto } from '@/shared/contracts';
import {
  ANTIGRAVITY_CLI_EXTENSION_ID,
  CODEX_EXTENSION_ID,
  CPA_IMAGE_API_EXTENSION_ID,
  DEEPSEEK_API_EXTENSION_ID,
  EXTERNAL_IMAGE_API_EXTENSION_IDS,
  NATURAL_WATERMARK_EXTENSION_ID,
  IMAGE_SEARCH_EXTENSION_ID,
  SCREEN_MAGNIFIER_EXTENSION_ID,
  OPENAI_IMAGE_API_EXTENSION_ID,
  PROMPT_RECIPES_EXTENSION_ID,
  TRANSITION_SHOWCASE_EXTENSION_ID,
} from '@/shared/extension-ids';
import { EXTENSION_PERMISSION } from '@/shared/extension-permissions';
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
import { ScreenMagnifierConfiguration } from '@/renderer/features/extensions/ScreenMagnifierConfiguration';
import type { TransitionShowcaseNavigationState } from '@/renderer/features/extensions/transitionShowcaseNavigation';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ImageSearchModelConfiguration } from '@/renderer/features/content-search/ImageSearchModelConfiguration';
import { ExtensionPackageDetails } from '@/renderer/features/extensions/ExtensionPackageDetails';
import { PromptRecipeConfiguration } from '@/renderer/features/extensions/PromptRecipeConfiguration';

const externalImageApiExtensionIds = new Set<string>(EXTERNAL_IMAGE_API_EXTENSION_IDS);

interface Props {
  data: BootstrapDto;
  onRecipesChanged(): void;
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
  data,
  onRecipesChanged,
  active,
  busyKey,
  extension,
  codexImagesNavigation,
  transitionShowcaseNavigation,
  notify,
  onConnectionChanged,
}: Props) {
  const naturalWatermark = extension.manifest.id === NATURAL_WATERMARK_EXTENSION_ID;
  return (
    <section data-extension-plugin-settings className="grid min-w-0 gap-5">
      {extension.manifest.id === PROMPT_RECIPES_EXTENSION_ID && (
        <PromptRecipeConfiguration
          key={data.spaceId}
          active={active}
          disabled={!extension.enabled || Boolean(busyKey)}
          data={data}
          notify={notify}
          onRecipesChanged={onRecipesChanged}
        />
      )}
      {extension.manifest.id === SCREEN_MAGNIFIER_EXTENSION_ID && (
        <ScreenMagnifierConfiguration extension={extension} disabled={!active || Boolean(busyKey)} notify={notify} />
      )}
      {extension.manifest.id === IMAGE_SEARCH_EXTENSION_ID && (
        <div className="min-w-0 max-w-xl">
          <ImageSearchModelConfiguration
            active={active && extension.enabled}
            accessKey={extension.permissions.map((permission) => `${permission.key}:${permission.granted}`).join(',')}
          />
        </div>
      )}
      {naturalWatermark && <NaturalWatermarkConfigurationPanel active={active && extension.enabled} notify={notify} />}
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
      <ExtensionPackageDetails extension={extension} />
    </section>
  );
}

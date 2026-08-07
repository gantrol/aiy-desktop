import { BlocksIcon, CircleAlertIcon, CircleCheckIcon, Settings2Icon } from 'lucide-react';
import type { BootstrapDto, ExtensionDto, ImageGenerationRouteDto, Locale } from '@/shared/contracts';
import {
  ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID,
  CODEX_APP_SERVER_EXTENSION_ID,
  CODEX_APP_SERVER_PROVIDER_KEY,
  CODEX_CLI_PROVIDER_KEY,
  DEEPSEEK_API_EXTENSION_ID,
  GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID,
  OPENAI_IMAGE_API_EXTENSION_ID,
  VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID,
} from '@/shared/extension-ids';
import { localizeExtensionManifest } from '@/shared/extension-localization';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { MetaText } from '@/renderer/components/ui/meta-text';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { StateTag } from '@/renderer/components/ui/state-tag';
import { useI18n } from '@/renderer/i18n/useI18n';
import { AiAssistantRoutingPanel } from '@/renderer/features/ai-center/AiAssistantRoutingPanel';

interface Props {
  active: boolean;
  data: BootstrapDto;
  locale: Locale;
  notify(message: string): void;
  onConfigure(extensionId: string | null): void;
  onManagePlugins(): void;
}

const extensionProviderKeys: Record<string, string[]> = {
  [CODEX_APP_SERVER_EXTENSION_ID]: [CODEX_APP_SERVER_PROVIDER_KEY, CODEX_CLI_PROVIDER_KEY],
  [OPENAI_IMAGE_API_EXTENSION_ID]: ['openai'],
  [GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID]: ['google'],
  [ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID]: ['alibaba-cloud'],
  [VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID]: ['volcengine'],
};

const assistantModelNames: Record<string, string[]> = {
  [DEEPSEEK_API_EXTENSION_ID]: ['DeepSeek V4 Flash'],
};

function modelsForExtension(extension: ExtensionDto, routes: ImageGenerationRouteDto[]) {
  const providerKeys = new Set(extensionProviderKeys[extension.manifest.id] ?? []);
  return routes.filter((model) => providerKeys.has(model.providerKey));
}

export function AiCapabilitiesView({ active, data, locale, notify, onConfigure, onManagePlugins }: Props) {
  const { messages } = useI18n();
  const l = messages.aiCenter;
  const capabilityExtensions = (data.extensions ?? []).filter(
    (extension) =>
      (extension.manifest.contributes.modelProviders?.length ?? 0) > 0 ||
      extension.manifest.id in extensionProviderKeys,
  );

  return (
    <ScrollArea className="min-h-0 flex-1 bg-background">
      <div className="mx-auto grid w-full max-w-6xl gap-7 p-5 lg:p-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{l.tabs.capabilities}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{l.capability.summary}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onManagePlugins}>
            <BlocksIcon className="size-4" />
            {l.actions.managePlugins}
          </Button>
        </header>

        <AiAssistantRoutingPanel
          active={active}
          extensions={data.extensions ?? []}
          notify={notify}
          onConfigureProvider={onConfigure}
        />

        <section className="grid gap-2.5">
          <h3 className="text-xs font-semibold text-foreground-secondary">{l.capability.modelsAndConnections}</h3>
          <div className="divide-y rounded-md border">
            {capabilityExtensions.map((extension) => {
              const copy = localizeExtensionManifest(extension.manifest, locale);
              const routes = modelsForExtension(extension, data.imageGenerationRoutes);
              const assistantModels = assistantModelNames[extension.manifest.id] ?? [];
              const modelNames = [...routes.map((model) => model.name), ...assistantModels];
              const ready =
                extension.connectionState === 'READY' &&
                extension.enabled &&
                (routes.length === 0 || routes.some((model) => model.state === 'READY'));
              return (
                <div
                  key={extension.manifest.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="truncate text-sm font-medium">{copy.displayName}</strong>
                      <StateTag
                        tone={ready ? 'success' : 'warning'}
                        icon={ready ? <CircleCheckIcon /> : <CircleAlertIcon />}
                      >
                        {ready ? l.capability.ready : l.capability.unavailable}
                      </StateTag>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <MetaText>{l.capability.modelCount(modelNames.length)}</MetaText>
                      {modelNames.map((name) => (
                        <Badge key={name} variant="secondary">
                          {name}
                        </Badge>
                      ))}
                      {!modelNames.length && <MetaText>{extension.connectionMessage}</MetaText>}
                    </div>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => onConfigure(extension.manifest.id)}>
                    <Settings2Icon className="size-3.5" />
                    {l.actions.configure}
                  </Button>
                </div>
              );
            })}
            {capabilityExtensions.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">{l.capability.noProviders}</div>
            )}
          </div>
        </section>

        <section className="grid gap-2.5">
          <h3 className="text-xs font-semibold text-foreground-secondary">{l.capability.authorization}</h3>
          <dl className="grid grid-cols-1 gap-x-8 rounded-md border px-4 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-4 border-b py-3">
              <dt className="text-xs">{l.capability.remoteDisclosure}</dt>
              <dd>
                <Badge variant="secondary">{l.capability.always}</Badge>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 border-b py-3">
              <dt className="text-xs">{l.capability.costConfirmation}</dt>
              <dd>
                <Badge variant="secondary">{l.capability.always}</Badge>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 border-b py-3 sm:border-b-0">
              <dt className="text-xs">{l.capability.visionGate}</dt>
              <dd>
                <Badge variant="outline">{l.capability.gated}</Badge>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-xs">{l.capability.relationActions}</dt>
              <dd>
                <Badge variant="outline">{l.capability.prohibited}</Badge>
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </ScrollArea>
  );
}

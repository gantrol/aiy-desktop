import { useEffect, useMemo, useState } from 'react';
import { CircleAlertIcon, CircleCheckIcon } from 'lucide-react';
import type {
  AssistantModelRouteDto,
  AssistantOperation,
  AssistantReasoningEffort,
  AssistantRoutingDto,
  AssistantRoutingSelection,
  AssistantRoutingSelections,
  ExtensionDto,
} from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import { StateTag } from '@/renderer/components/ui/state-tag';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  AssistantRoutingConfigurationField,
  effectiveAssistantModelKey,
  effectiveAssistantReasoningEffort,
} from '@/renderer/features/ai-center/AssistantRoutingConfigurationField';

interface Props {
  active: boolean;
  extensions: ExtensionDto[];
  notify(message: string): void;
  onConfigureProvider(extensionId: string): void;
}

const operations: AssistantOperation[] = [
  'directions',
  'optimize',
  'title',
  'gifPlanning',
  'subtitleTranslation',
  'articleCheck',
];

export function AiAssistantRoutingPanel({ active, extensions, notify, onConfigureProvider }: Props) {
  const { messages } = useI18n();
  const l = messages.aiCenter.routing;
  const providerRevision = extensions
    .map(
      (extension) =>
        `${extension.manifest.id}:${extension.enabled}:${extension.connectionState}:${extension.connectionMessage}`,
    )
    .join('|');
  const [routing, setRouting] = useState<AssistantRoutingDto | null>(null);
  const [draft, setDraft] = useState<AssistantRoutingSelections | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setRouting(await window.desktopApi.assistantRoutingGet());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (active) void load();
  }, [active, providerRevision]);

  const modelsByKey = useMemo(
    () => new Map(routing?.models.map((model) => [model.key, model]) ?? []),
    [routing?.models],
  );

  function operationLabel(operation: AssistantOperation) {
    if (operation === 'directions') return l.directionsAction;
    if (operation === 'optimize') return l.optimizeAction;
    if (operation === 'gifPlanning') return l.gifPlanningAction;
    if (operation === 'subtitleTranslation') return l.subtitleTranslationAction;
    if (operation === 'articleCheck') return l.articleCheckAction;
    return l.titleAction;
  }

  function kindLabel(model: AssistantModelRouteDto) {
    return model.kind === 'AGENT' ? l.agentModel : l.textModel;
  }

  function effortLabel(effort: AssistantReasoningEffort) {
    return l.reasoningEfforts[effort];
  }

  function selectionLabel(model: AssistantModelRouteDto, selection: AssistantRoutingSelection) {
    if (model.modelSelectionMode !== 'CATALOG') return model.name;
    const modelKey = effectiveAssistantModelKey(model, selection);
    const name = model.modelOptions.find((option) => option.key === modelKey)?.name ?? modelKey;
    const effort = effectiveAssistantReasoningEffort(model, selection);
    return [model.name, name, effort ? effortLabel(effort) : null].filter(Boolean).join(' · ');
  }

  function openConfiguration() {
    if (!routing) return;
    setDraft({
      directions: { ...routing.selections.directions },
      optimize: { ...routing.selections.optimize },
      title: { ...routing.selections.title },
      gifPlanning: { ...routing.selections.gifPlanning },
      subtitleTranslation: { ...routing.selections.subtitleTranslation },
      articleCheck: { ...routing.selections.articleCheck },
    });
    setError('');
    setOpen(true);
  }

  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    setError('');
    try {
      const next = await window.desktopApi.assistantRoutingSave({ selections: draft });
      setRouting(next);
      setOpen(false);
      notify(l.saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="grid gap-2.5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold text-foreground-secondary">{l.title}</h3>
          <Button type="button" variant="outline" size="sm" disabled={loading || !routing} onClick={openConfiguration}>
            {messages.aiCenter.actions.configure}
          </Button>
        </div>
        <div className="divide-y rounded-md border" aria-busy={loading}>
          {operations.map((operation) => {
            const selection = routing?.selections[operation] ?? null;
            const model = selection ? (modelsByKey.get(selection.routeKey) ?? null) : null;
            const ready = model?.state === 'READY';
            return (
              <div key={operation} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3">
                <div className="min-w-0">
                  <strong className="block text-sm font-medium">{operationLabel(operation)}</strong>
                  {loading ? (
                    <Skeleton className="mt-2 h-3 w-32" />
                  ) : (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="truncate text-xs text-muted-foreground">
                        {model && selection ? selectionLabel(model, selection) : '—'}
                      </span>
                      {model && <Badge variant="secondary">{kindLabel(model)}</Badge>}
                    </div>
                  )}
                </div>
                {loading ? (
                  <Skeleton className="h-5 w-14 rounded-full" />
                ) : model ? (
                  <StateTag
                    tone={ready ? 'success' : 'warning'}
                    icon={ready ? <CircleCheckIcon /> : <CircleAlertIcon />}
                  >
                    {ready ? messages.aiCenter.capability.ready : messages.aiCenter.capability.unavailable}
                  </StateTag>
                ) : null}
              </div>
            );
          })}
        </div>
        {error && !open && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </section>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
      >
        <DialogContent className="h-[min(760px,calc(100dvh-2rem))] max-w-xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b px-6 py-4 pr-14">
            <DialogTitle>{l.dialogTitle}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="min-h-0">
            <div className="grid gap-4 px-6 py-4">
              {operations.map((operation) => (
                <AssistantRoutingConfigurationField
                  key={operation}
                  operation={operation}
                  operationLabel={operationLabel(operation)}
                  selection={draft?.[operation] ?? null}
                  routes={routing?.models ?? []}
                  busy={busy}
                  modelLabel={l.model}
                  codexModelLabel={l.codexModel}
                  reasoningEffortLabel={l.reasoningEffort}
                  configureConnectionLabel={l.configureConnection}
                  kindLabel={kindLabel}
                  effortLabel={effortLabel}
                  onChange={(selection) =>
                    setDraft((current) => (current ? { ...current, [operation]: selection } : current))
                  }
                  onConfigureProvider={(extensionId) => {
                    setOpen(false);
                    onConfigureProvider(extensionId);
                  }}
                />
              ))}
              {error && (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
            </div>
          </ScrollArea>
          <DialogFooter className="border-t px-6 py-4">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              {messages.common.cancel}
            </Button>
            <Button type="button" disabled={busy || !draft} onClick={() => void save()}>
              {l.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

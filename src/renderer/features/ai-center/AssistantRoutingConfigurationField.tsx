import type {
  AssistantModelRouteDto,
  AssistantOperation,
  AssistantReasoningEffort,
  AssistantRoutingSelection,
} from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';

interface Props {
  operation: AssistantOperation;
  operationLabel: string;
  selection: AssistantRoutingSelection | null;
  routes: AssistantModelRouteDto[];
  busy: boolean;
  modelLabel: string;
  codexModelLabel: string;
  reasoningEffortLabel: string;
  configureConnectionLabel: string;
  kindLabel(model: AssistantModelRouteDto): string;
  effortLabel(effort: AssistantReasoningEffort): string;
  onChange(selection: AssistantRoutingSelection): void;
  onConfigureProvider(extensionId: string): void;
}

export function effectiveAssistantModelKey(route: AssistantModelRouteDto, selection: AssistantRoutingSelection) {
  return selection.modelKey ?? route.modelKey;
}

export function effectiveAssistantReasoningEffort(route: AssistantModelRouteDto, selection: AssistantRoutingSelection) {
  return selection.reasoningEffort ?? route.reasoningEffort;
}

function selectableModels(route: AssistantModelRouteDto, selection: AssistantRoutingSelection) {
  const selectedKey = effectiveAssistantModelKey(route, selection);
  return route.modelOptions.some((model) => model.key === selectedKey)
    ? route.modelOptions
    : [
        {
          key: selectedKey,
          name: selectedKey,
          isDefault: false,
          defaultReasoningEffort: route.reasoningEffort,
          supportedReasoningEfforts: route.reasoningEffort ? [route.reasoningEffort] : [],
        },
        ...route.modelOptions,
      ];
}

export function AssistantRoutingConfigurationField({
  operation,
  operationLabel,
  selection,
  routes,
  busy,
  modelLabel,
  codexModelLabel,
  reasoningEffortLabel,
  configureConnectionLabel,
  kindLabel,
  effortLabel,
  onChange,
  onConfigureProvider,
}: Props) {
  const route = selection ? (routes.find((candidate) => candidate.key === selection.routeKey) ?? null) : null;
  const models = route && selection ? selectableModels(route, selection) : [];
  const selectedModelKey = route && selection ? effectiveAssistantModelKey(route, selection) : '';
  const selectedModel = models.find((model) => model.key === selectedModelKey) ?? null;
  const selectedEffort = route && selection ? effectiveAssistantReasoningEffort(route, selection) : null;
  const effortChoices = selectedModel
    ? selectedEffort && !selectedModel.supportedReasoningEfforts.includes(selectedEffort)
      ? [selectedEffort, ...selectedModel.supportedReasoningEfforts]
      : selectedModel.supportedReasoningEfforts
    : [];

  return (
    <div className="grid gap-2 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <strong className="text-sm font-medium">{operationLabel}</strong>
        {route && <Badge variant="secondary">{kindLabel(route)}</Badge>}
      </div>
      <Select
        value={selection?.routeKey ?? ''}
        disabled={busy}
        onValueChange={(value) => onChange({ routeKey: value, modelKey: null, reasoningEffort: null })}
      >
        <SelectTrigger aria-label={`${operationLabel} · ${modelLabel}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {routes
            .filter((candidate) => candidate.supportedOperations.includes(operation))
            .map((candidate) => (
              <SelectItem key={candidate.key} value={candidate.key} disabled={candidate.state !== 'READY'}>
                {candidate.name} · {kindLabel(candidate)}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      {route?.modelSelectionMode === 'CATALOG' && selection && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground-secondary">{codexModelLabel}</span>
            <Select
              value={selectedModelKey}
              disabled={busy || models.length < 2}
              onValueChange={(value) => {
                const nextModel = models.find((model) => model.key === value);
                const nextEffort =
                  selectedEffort && nextModel?.supportedReasoningEfforts.includes(selectedEffort)
                    ? selectedEffort
                    : (nextModel?.defaultReasoningEffort ??
                      nextModel?.supportedReasoningEfforts[0] ??
                      route.reasoningEffort);
                onChange({ ...selection, modelKey: value, reasoningEffort: nextEffort });
              }}
            >
              <SelectTrigger aria-label={`${operationLabel} · ${codexModelLabel}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {models.map((model) => (
                  <SelectItem key={model.key} value={model.key}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {effortChoices.length > 0 && selectedEffort && (
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground-secondary">{reasoningEffortLabel}</span>
              <Select
                value={selectedEffort}
                disabled={busy || effortChoices.length < 2}
                onValueChange={(value) =>
                  onChange({ ...selection, reasoningEffort: value as AssistantReasoningEffort })
                }
              >
                <SelectTrigger aria-label={`${operationLabel} · ${reasoningEffortLabel}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {effortChoices.map((effort) => (
                    <SelectItem key={effort} value={effort}>
                      {effortLabel(effort)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}
      {route?.availabilityReason && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-warning">{route.availabilityReason}</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => onConfigureProvider(route.extensionId)}>
            {configureConnectionLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

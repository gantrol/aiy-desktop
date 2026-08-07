import { useId, useState, type KeyboardEvent } from 'react';
import {
  CheckIcon,
  FlaskConicalIcon,
  LockIcon,
  SearchIcon,
  Settings2Icon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import type { ImageGenerationRouteDto } from '@/shared/contracts';
import { generationProviderExtensionId } from '@/shared/extension-ids';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { StateTag } from '@/renderer/components/ui/state-tag';

interface Props {
  routes: ImageGenerationRouteDto[];
  selectedModelKeys: string[];
  emptyText?: string;
  capabilityTag?: ModelCapabilityTag;
  onSelectedModelKeysChange(modelKeys: string[]): void;
  onConfigureExtension?(extensionId: string): void;
}

export interface ModelCapabilityTag {
  supports(model: ImageGenerationRouteDto): boolean;
  supportedLabel: string;
  unsupportedLabel: string;
}

function matchesQuery(model: ImageGenerationRouteDto, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [model.name, model.provider, model.modelId, model.key].some((value) =>
    value.toLocaleLowerCase().includes(normalized),
  );
}

/** Searchable multi-select listbox. Focus stays in the search field while aria-activedescendant tracks navigation. */
export function ModelSelectionCommand({
  routes,
  selectedModelKeys,
  emptyText,
  capabilityTag,
  onSelectedModelKeysChange,
  onConfigureExtension,
}: Props) {
  const { messages } = useI18n();
  const labels = messages.creator.generationTargets;
  const configureLabel = messages.aiCenter.actions.configure;
  const listId = useId();
  const [query, setQuery] = useState('');
  const [activeModelKey, setActiveModelKey] = useState<string | null>(null);
  const filteredModels = routes.filter((model) => matchesQuery(model, query));
  const isDisabled = (model: ImageGenerationRouteDto) =>
    model.state !== 'READY' && !selectedModelKeys.includes(model.key);
  const selectableModels = filteredModels.filter((model) => !isDisabled(model));
  const resolvedActiveKey = selectableModels.some((model) => model.key === activeModelKey)
    ? activeModelKey
    : (selectableModels[0]?.key ?? null);
  const groups = filteredModels.reduce<Array<{ provider: string; routes: ImageGenerationRouteDto[] }>>(
    (current, model) => {
      const provider = model.provider || labels.models;
      const group = current.find((item) => item.provider === provider);
      if (group) group.routes.push(model);
      else current.push({ provider, routes: [model] });
      return current;
    },
    [],
  );

  function optionId(modelKey: string) {
    return `${listId}-option-${modelKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  }

  function toggle(modelKey: string) {
    onSelectedModelKeysChange(
      selectedModelKeys.includes(modelKey)
        ? selectedModelKeys.filter((key) => key !== modelKey)
        : [...selectedModelKeys, modelKey],
    );
  }

  function moveActive(delta: -1 | 1) {
    if (!selectableModels.length) return;
    const current = selectableModels.findIndex((model) => model.key === resolvedActiveKey);
    const next =
      current < 0
        ? delta > 0
          ? 0
          : selectableModels.length - 1
        : (current + delta + selectableModels.length) % selectableModels.length;
    setActiveModelKey(selectableModels[next].key);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Home' && selectableModels.length) {
      event.preventDefault();
      setActiveModelKey(selectableModels[0].key);
      return;
    }
    if (event.key === 'End' && selectableModels.length) {
      event.preventDefault();
      setActiveModelKey(selectableModels[selectableModels.length - 1].key);
      return;
    }
    if (event.key === 'Enter' && resolvedActiveKey) {
      event.preventDefault();
      toggle(resolvedActiveKey);
    }
  }

  return (
    <div
      data-slot="model-selection-command"
      className="flex size-full flex-col overflow-hidden rounded-md bg-overlay text-foreground"
    >
      <div className="flex h-10 items-center gap-2 border-b px-3 focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring">
        <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          type="text"
          role="combobox"
          aria-label={labels.searchModels}
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={resolvedActiveKey ? optionId(resolvedActiveKey) : undefined}
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          placeholder={labels.searchModels}
          value={query}
          onChange={(event) => {
            const nextQuery = event.currentTarget.value;
            setQuery(nextQuery);
            setActiveModelKey(
              routes.find((model) => matchesQuery(model, nextQuery) && !isDisabled(model))?.key ?? null,
            );
          }}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div
        id={listId}
        role="listbox"
        aria-label={labels.models}
        aria-multiselectable="true"
        className="max-h-80 overflow-x-hidden overflow-y-auto p-1"
      >
        {!filteredModels.length && (
          <p role="status" className="py-8 text-center text-xs text-muted-foreground">
            {emptyText ?? labels.noMatchingModels}
          </p>
        )}
        {groups.map((group, groupIndex) => {
          const headingId = `${listId}-group-${groupIndex}`;
          return (
            <div key={group.provider} role="group" aria-labelledby={headingId} className="overflow-hidden py-1">
              <p id={headingId} className="px-2 py-1.5 text-2xs font-medium text-muted-foreground">
                {group.provider}
              </p>
              {group.routes.map((model) => {
                const checked = selectedModelKeys.includes(model.key);
                const disabled = isDisabled(model);
                const active = resolvedActiveKey === model.key;
                const name = model.key === 'internal-library-random' ? labels.internalLibraryRandom : model.name;
                const capabilitySupported = capabilityTag?.supports(model) ?? false;
                const capabilityLabel = capabilityTag
                  ? capabilitySupported
                    ? capabilityTag.supportedLabel
                    : capabilityTag.unsupportedLabel
                  : null;
                const configurationExtensionId = generationProviderExtensionId(model.providerKey);
                return (
                  <div
                    key={model.key}
                    data-model-key={model.key}
                    data-active={active || undefined}
                    data-checked={checked || undefined}
                    title={model.modelId}
                    className={cn(
                      'relative flex min-h-9 select-none items-center rounded-sm text-sm outline-none',
                      disabled ? 'text-disabled-foreground' : 'hover:bg-hover',
                      active && !checked && 'bg-hover',
                      checked && 'bg-selected text-selected-foreground hover:bg-selected',
                    )}
                  >
                    <button
                      type="button"
                      id={optionId(model.key)}
                      role="option"
                      tabIndex={-1}
                      aria-selected={checked}
                      aria-disabled={disabled}
                      aria-label={[name, capabilityLabel, disabled ? labels.unavailable : null]
                        .filter(Boolean)
                        .join(', ')}
                      className={cn(
                        'flex min-w-0 flex-1 items-center gap-2 bg-transparent px-2 py-1.5 text-left outline-none',
                        disabled ? 'cursor-default' : 'cursor-pointer',
                      )}
                      onPointerMove={() => !disabled && setActiveModelKey(model.key)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => !disabled && toggle(model.key)}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'grid size-4 shrink-0 place-items-center rounded-sm border border-border',
                          checked && 'border-selected-border bg-selected text-selected-foreground',
                        )}
                      >
                        {checked && <CheckIcon className="size-3" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{name}</span>
                      {capabilityLabel && (
                        <StateTag
                          tone={capabilitySupported ? 'success' : 'warning'}
                          icon={capabilitySupported ? <ShieldCheckIcon /> : <TriangleAlertIcon />}
                        >
                          {capabilityLabel}
                        </StateTag>
                      )}
                      {model.releaseStage === 'PREVIEW' && (
                        <StateTag tone="info" icon={<FlaskConicalIcon />}>
                          {labels.preview}
                        </StateTag>
                      )}
                      {disabled && (!configurationExtensionId || !onConfigureExtension) && (
                        <StateTag tone="locked" icon={<LockIcon />}>
                          {labels.unavailable}
                        </StateTag>
                      )}
                    </button>
                    {model.state !== 'READY' && configurationExtensionId && onConfigureExtension && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="2xs"
                        className="mr-1 gap-1"
                        title={`${configureLabel}: ${name}`}
                        aria-label={`${configureLabel}: ${name}`}
                        onClick={() => onConfigureExtension(configurationExtensionId)}
                      >
                        <Settings2Icon className="size-3.5" />
                        {configureLabel}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import type { ExternalMaterialMetadataDto } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useProvenanceSuggestions } from '@/renderer/components/provenance/useProvenanceSuggestions';
import { ComboboxInput } from '@/renderer/components/ui/combobox-input';
import { Input } from '@/renderer/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Textarea } from '@/renderer/components/ui/textarea';

export interface MaterialMetadataEditorState {
  dirty: boolean;
  saving: boolean;
  valid: boolean;
}

interface Props {
  metadata: ExternalMaterialMetadataDto;
  formId: string;
  onStateChange(state: MaterialMetadataEditorState): void;
  onUpdated(metadata: ExternalMaterialMetadataDto): void;
  notify(message: string): void;
}

export function MaterialMetadataEditor({ metadata, formId, onStateChange, onUpdated, notify }: Props) {
  const l = useI18n().messages.creator.generationRecord;
  const [displayName, setDisplayName] = useState(metadata.displayName);
  const [note, setNote] = useState(metadata.note);
  const [sourceUrl, setSourceUrl] = useState(metadata.sourceUrl);
  const [aiStatus, setAiStatus] = useState(metadata.aiGeneratedStatus);
  const [modelName, setModelName] = useState(metadata.modelName);
  const [modelProvider, setModelProvider] = useState(metadata.modelProvider);
  const [modelVersion, setModelVersion] = useState(metadata.modelVersion);
  const [generationTextType, setGenerationTextType] = useState(metadata.generationTextType);
  const [generationText, setGenerationText] = useState(metadata.generationText);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDisplayName(metadata.displayName);
    setNote(metadata.note);
    setSourceUrl(metadata.sourceUrl);
    setAiStatus(metadata.aiGeneratedStatus);
    setModelName(metadata.modelName);
    setModelProvider(metadata.modelProvider);
    setModelVersion(metadata.modelVersion);
    setGenerationTextType(metadata.generationTextType);
    setGenerationText(metadata.generationText);
  }, [metadata]);

  const suggestions = useProvenanceSuggestions();

  const dirty =
    displayName !== metadata.displayName ||
    note !== metadata.note ||
    sourceUrl !== metadata.sourceUrl ||
    aiStatus !== metadata.aiGeneratedStatus ||
    modelName !== metadata.modelName ||
    modelProvider !== metadata.modelProvider ||
    modelVersion !== metadata.modelVersion ||
    generationTextType !== metadata.generationTextType ||
    generationText !== metadata.generationText;
  const valid = Boolean(displayName.trim());

  useEffect(() => {
    onStateChange({ dirty, saving, valid });
  }, [dirty, onStateChange, saving, valid]);

  function selectAiStatus(value: string) {
    const next = value as ExternalMaterialMetadataDto['aiGeneratedStatus'];
    setAiStatus(next);
    if (next !== 'NO') return;
    setModelName('');
    setModelProvider('');
    setModelVersion('');
  }

  async function save() {
    if (saving || !valid || !dirty) return;
    setSaving(true);
    try {
      const updated = await window.desktopApi.materialMetadataUpdate({
        materialId: metadata.materialId,
        displayName,
        note,
        sourceUrl,
        aiGeneratedStatus: aiStatus,
        modelName,
        modelProvider,
        modelVersion,
        generationTextType,
        generationText,
      });
      setDisplayName(updated.displayName);
      setNote(updated.note);
      setSourceUrl(updated.sourceUrl);
      setAiStatus(updated.aiGeneratedStatus);
      setModelName(updated.modelName);
      setModelProvider(updated.modelProvider);
      setModelVersion(updated.modelVersion);
      setGenerationTextType(updated.generationTextType);
      setGenerationText(updated.generationText);
      suggestions.remember(updated.modelName, updated.modelProvider);
      onUpdated(updated);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  const modelDisabled = aiStatus === 'NO';
  const textLabel =
    generationTextType === 'EXACT_PROMPT'
      ? l.exactPrompt
      : generationTextType === 'DESCRIPTION'
        ? l.description
        : generationTextType === 'RECONSTRUCTION'
          ? l.reconstructedPrompt
          : l.generationText;
  return (
    <form
      id={formId}
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Input
        data-field="material-display-name"
        value={displayName}
        aria-label={l.name}
        placeholder={l.name}
        onChange={(event) => setDisplayName(event.target.value)}
      />
      <Input
        type="url"
        value={sourceUrl}
        aria-label={l.sourceUrl}
        placeholder={l.sourceUrl}
        onChange={(event) => setSourceUrl(event.target.value)}
      />
      <Select value={aiStatus} onValueChange={selectAiStatus}>
        <SelectTrigger aria-label={l.aiGeneratedLabel}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="UNKNOWN">{l.unknown}</SelectItem>
          <SelectItem value="YES">{l.aiGenerated}</SelectItem>
          <SelectItem value="NO">{l.notAiGenerated}</SelectItem>
          <SelectItem value="OTHER">{l.otherProvenance}</SelectItem>
        </SelectContent>
      </Select>
      <div className="grid grid-cols-2 gap-2">
        <ComboboxInput
          value={modelName}
          suggestions={suggestions.modelsForSource(modelProvider)}
          disabled={modelDisabled}
          aria-label={l.model}
          placeholder={l.modelPlaceholder}
          openLabel={l.modelOptions}
          onValueChange={setModelName}
        />
        <ComboboxInput
          value={modelProvider}
          suggestions={suggestions.sourcesForModel(modelName)}
          disabled={modelDisabled}
          aria-label={l.platform}
          placeholder={l.platformPlaceholder}
          openLabel={l.platformOptions}
          onValueChange={setModelProvider}
        />
        <Input
          className="col-span-2"
          value={modelVersion}
          disabled={modelDisabled}
          aria-label={l.version}
          placeholder={l.version}
          onChange={(event) => setModelVersion(event.target.value)}
        />
      </div>
      <Textarea
        className="min-h-24"
        value={generationText}
        aria-label={textLabel}
        placeholder={textLabel}
        onChange={(event) => setGenerationText(event.target.value)}
      />
      <Textarea
        className="min-h-20"
        value={note}
        aria-label={l.note}
        placeholder={l.note}
        onChange={(event) => setNote(event.target.value)}
      />
    </form>
  );
}

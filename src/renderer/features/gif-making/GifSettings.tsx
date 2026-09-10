import { useI18n } from '@/renderer/i18n/useI18n';
import { useEffect, useState } from 'react';
import { Input } from '@/renderer/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Button } from '@/renderer/components/ui/button';
import type { GifManifest } from '@/shared/contracts/gif-making';

export function GifNumber({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  id?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange(value: number): void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const next = Number(draft);
    if (draft.trim() && Number.isFinite(next)) {
      const bounded = Math.min(max, Math.max(min, Math.round(next / step) * step));
      const rounded = Number(bounded.toFixed(4));
      onChange(rounded);
      setDraft(String(rounded));
    } else setDraft(String(value));
  };
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Input
        aria-label={label}
        data-control={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        className="h-8 w-full text-foreground"
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
      />
    </label>
  );
}
export function GifChoice<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id?: string;
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange(value: T): void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Select value={value} onValueChange={(value) => onChange(value as T)}>
        <SelectTrigger data-control={id} aria-label={label} className="h-8 text-foreground">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem data-option-id={option.value} key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
export function GifSettings({
  manifest,
  change,
  chooseBackground,
  importBackground,
}: {
  manifest: GifManifest;
  change(operation: (value: GifManifest) => GifManifest): void;
  chooseBackground(): void;
  importBackground(): void;
}) {
  const labels = useI18n().messages.creator.gifMaker;
  return (
    <div className="grid grid-cols-2 gap-3">
      <GifNumber
        label={labels.width}
        id="gif-width"
        value={manifest.width}
        min={1}
        max={2048}
        onChange={(width) => change((value) => ({ ...value, width }))}
      />
      <GifNumber
        label={labels.height}
        id="gif-height"
        value={manifest.height}
        min={1}
        max={2048}
        onChange={(height) => change((value) => ({ ...value, height }))}
      />
      <GifChoice
        label={labels.fit}
        value={manifest.fit}
        options={[
          { value: 'CONTAIN', label: labels.contain },
          { value: 'COVER', label: labels.cover },
        ]}
        onChange={(fit) => change((value) => ({ ...value, fit }))}
      />
      <GifChoice
        label={labels.loop}
        id="gif-loop"
        value={manifest.loop}
        options={[
          { value: 'FOREVER', label: labels.forever },
          { value: 'ONCE', label: labels.once },
        ]}
        onChange={(loop) => change((value) => ({ ...value, loop }))}
      />
      {!manifest.generationId && (
        <GifChoice
          label={labels.frames}
          id="gif-playback"
          value={manifest.playback}
          options={[
            { value: 'FORWARD', label: labels.forward },
            { value: 'PING_PONG', label: labels.pingPong },
          ]}
          onChange={(playback) => change((value) => ({ ...value, playback }))}
        />
      )}
      <GifChoice
        label={labels.background}
        value={manifest.backgroundColor ? 'COLOR' : 'TRANSPARENT'}
        options={[
          { value: 'TRANSPARENT', label: labels.transparent },
          { value: 'COLOR', label: labels.color },
        ]}
        onChange={(kind) => change((value) => ({ ...value, backgroundColor: kind === 'COLOR' ? '#ffffff' : null }))}
      />
      {manifest.backgroundColor && (
        <label className="text-xs text-muted-foreground">
          {labels.color}
          <Input
            type="color"
            aria-label={labels.color}
            value={manifest.backgroundColor}
            className="mt-1 h-8 p-1"
            onChange={(event) => change((value) => ({ ...value, backgroundColor: event.target.value }))}
          />
        </label>
      )}
      <div className="col-span-2 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={importBackground}>
          {labels.importBackground}
        </Button>
        <Button variant="outline" size="sm" onClick={chooseBackground}>
          {labels.addBackground}
        </Button>
        {manifest.backgroundAssetId && (
          <Button
            data-action="gif-remove-background"
            variant="ghost"
            size="sm"
            onClick={() => change((value) => ({ ...value, backgroundAssetId: null }))}
          >
            {labels.removeBackground}
          </Button>
        )}
      </div>
      <GifNumber
        label={labels.scale}
        min={0.1}
        max={2}
        step={0.05}
        value={manifest.foreground.scale}
        onChange={(scale) => change((value) => ({ ...value, foreground: { ...value.foreground, scale } }))}
      />
      <GifNumber
        label={labels.offsetX}
        min={-1}
        max={1}
        step={0.01}
        value={manifest.foreground.x}
        onChange={(x) => change((value) => ({ ...value, foreground: { ...value.foreground, x } }))}
      />
      <GifNumber
        label={labels.offsetY}
        min={-1}
        max={1}
        step={0.01}
        value={manifest.foreground.y}
        onChange={(y) => change((value) => ({ ...value, foreground: { ...value.foreground, y } }))}
      />
    </div>
  );
}

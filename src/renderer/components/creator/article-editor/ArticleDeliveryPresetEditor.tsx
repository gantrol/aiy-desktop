import { useId, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ArticleDeliveryPreferences } from '@/renderer/features/article-delivery/articleDeliveryPreferences';
import {
  ARTICLE_DELIVERY_PRESET_LIMIT,
  readArticleDeliveryPresets,
  removeArticleDeliveryPreset,
  saveArticleDeliveryPreset,
} from '@/renderer/features/article-delivery/articleDeliveryPresets';

export function ArticleDeliveryPresetEditor({
  disabled,
  preferences,
  notify,
}: {
  disabled: boolean;
  preferences: ArticleDeliveryPreferences;
  notify(message: string): void;
}) {
  const { messages } = useI18n();
  const copy = messages.articleDelivery.batch;
  const id = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [presets, setPresets] = useState(readArticleDeliveryPresets);
  const [error, setError] = useState<string | null>(null);
  const existing = presets.some((preset) => preset.name === name.trim());
  const atLimit = !existing && presets.length >= ARTICLE_DELIVERY_PRESET_LIMIT;

  function finish(saved: boolean, message: string) {
    if (!saved) {
      setError(copy.preferenceFailed);
      return;
    }
    setOpen(false);
    notify(message);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setPresets(readArticleDeliveryPresets());
          setName('');
          setError(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" disabled={disabled}>
          {copy.savePreset}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!disabled && name.trim() && !atLimit)
              finish(saveArticleDeliveryPreset(name, preferences), copy.presetSaved);
          }}
        >
          <label htmlFor={id} className="text-sm font-medium">
            {copy.presetName}
          </label>
          <Input
            id={id}
            value={name}
            maxLength={80}
            disabled={disabled}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
          {(error || atLimit) && (
            <p role="alert" className="text-sm text-destructive">
              {error ?? copy.presetLimit}
            </p>
          )}
          <div className="flex justify-end gap-2">
            {existing && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => finish(removeArticleDeliveryPreset(name), copy.presetDeleted)}
              >
                {copy.deletePreset}
              </Button>
            )}
            <Button type="submit" size="sm" disabled={disabled || !name.trim() || atLimit}>
              {existing ? copy.updatePreset : copy.savePreset}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

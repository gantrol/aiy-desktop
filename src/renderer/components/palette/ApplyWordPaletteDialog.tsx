import { useEffect, useState } from 'react';
import type { Locale, WordPaletteDto } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { Label } from '@/renderer/components/ui/label';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { defaultWordPaletteParameterValues } from '@/renderer/components/palette/utils';

interface Props {
  locale: Locale;
  defaultPromptLocale: Locale;
  initialValues?: Record<string, string>;
  initialPromptLocale?: Locale;
  palette: WordPaletteDto | null;
  open: boolean;
  onOpenChange(open: boolean): void;
  onApply(values: Record<string, string>, promptLocale: Locale): void;
}

export function ApplyWordPaletteDialog({
  defaultPromptLocale,
  initialValues,
  initialPromptLocale,
  palette,
  open,
  onOpenChange,
  onApply,
}: Props) {
  const { messages } = useI18n();
  const l = messages.recipe.apply;
  const [values, setValues] = useState<Record<string, string>>({});
  const [promptLocale, setPromptLocale] = useState<Locale>(defaultPromptLocale);

  useEffect(() => {
    if (!open || !palette) return;
    const defaults = defaultWordPaletteParameterValues(palette);
    setValues(
      Object.fromEntries(
        palette.parameters.map((parameter) => [
          parameter.stableKey,
          initialValues?.[parameter.stableKey] ?? defaults[parameter.stableKey],
        ]),
      ),
    );
    setPromptLocale(initialPromptLocale ?? defaultPromptLocale);
  }, [open, palette, defaultPromptLocale, initialPromptLocale, initialValues]);

  if (!palette) return null;
  const valid = palette.parameters.every((parameter) => !parameter.required || Boolean(values[parameter.stableKey]));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {palette.name} · V{palette.revisionNo}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>{l.language}</Label>
            <Segmented
              type="single"
              value={promptLocale}
              onValueChange={(value) => value && setPromptLocale(value as Locale)}
              className="grid grid-cols-2"
            >
              <SegmentedItem value="zh">{l.chinese}</SegmentedItem>
              <SegmentedItem value="en">{l.english}</SegmentedItem>
            </Segmented>
          </div>
          {palette.parameters.map((parameter) => (
            <div key={parameter.id} className="grid gap-2">
              <Label>{parameter.name}</Label>
              <Select
                value={values[parameter.stableKey] || '__optional'}
                onValueChange={(value) =>
                  setValues((current) => ({ ...current, [parameter.stableKey]: value === '__optional' ? '' : value }))
                }
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder={l.optional} />
                </SelectTrigger>
                <SelectContent>
                  {!parameter.required && <SelectItem value="__optional">{l.optional}</SelectItem>}
                  {parameter.options.map((option) => (
                    <SelectItem key={option.id} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {l.cancel}
          </Button>
          <Button
            type="button"
            disabled={!valid}
            onClick={() => {
              onApply(values, promptLocale);
              onOpenChange(false);
            }}
          >
            {l.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { InfoIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Label } from '@/renderer/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  isRecommendedTextCoverFont,
  localTextCoverFonts,
  textCoverFontFamily,
} from '@/renderer/features/text-covers/textCoverFonts';
import {
  textCoverLayouts,
  textCoverDecorations,
  textCoverPalettes,
  type TextCoverRecipe,
} from '@/renderer/features/text-covers/textCoverPresets';
import { ARTICLE_COVER_RATIOS, type ArticleCoverRatio } from '@/shared/article-covers';
import { useId } from 'react';

function CoverSelect({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: readonly { id: string; label: string; family?: string; recommended?: string; disabled?: boolean }[];
  onChange(value: string): void;
}) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {choices.map((choice) => (
            <SelectItem key={choice.id} value={choice.id} disabled={choice.disabled}>
              <span className="flex items-center gap-2">
                <span style={choice.family ? { fontFamily: choice.family } : undefined}>{choice.label}</span>
                {choice.recommended && <span className="text-xs text-muted-foreground">{choice.recommended}</span>}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function TextCoverControls({
  recipe,
  ratio,
  installedFonts,
  onChange,
  onRatioChange,
}: {
  recipe: TextCoverRecipe;
  ratio: ArticleCoverRatio;
  installedFonts: readonly string[];
  onChange(recipe: TextCoverRecipe): void;
  onRatioChange?(ratio: ArticleCoverRatio): void;
}) {
  const copy = useI18n().messages.contentEditor.textCover;
  const fontChoices = [
    ...localTextCoverFonts
      .filter((font) => installedFonts.includes(font.id) || font.id === recipe.font)
      .sort((a, b) => Number(isRecommendedTextCoverFont(b.id)) - Number(isRecommendedTextCoverFont(a.id)))
      .map((font) => ({
        id: font.id,
        label: copy.fonts[font.id],
        family: installedFonts.includes(font.id) ? textCoverFontFamily(font.id) : undefined,
        disabled: !installedFonts.includes(font.id),
        recommended: isRecommendedTextCoverFont(font.id) ? copy.recommended : undefined,
      })),
    ...(['sans', 'serif', 'kai'] as const).map((id) => ({
      id,
      label: copy.fonts[id],
      family: textCoverFontFamily(id),
    })),
  ];
  return (
    <div className="grid gap-3">
      {onRatioChange && (
        <CoverSelect
          label={copy.ratio}
          value={ratio}
          choices={ARTICLE_COVER_RATIOS.map((id) => ({ id, label: id }))}
          onChange={(value) => onRatioChange(value as ArticleCoverRatio)}
        />
      )}
      <div className="grid grid-cols-2 gap-3">
        <CoverSelect
          label={copy.layout}
          value={recipe.layout}
          choices={textCoverLayouts.map((id) => ({ id, label: copy.layouts[id] }))}
          onChange={(value) => onChange({ ...recipe, layout: value as TextCoverRecipe['layout'] })}
        />
        <CoverSelect
          label={copy.palette}
          value={recipe.palette}
          choices={Object.keys(textCoverPalettes).map((id) => ({
            id,
            label: copy.palettes[id as TextCoverRecipe['palette']],
          }))}
          onChange={(value) => onChange({ ...recipe, palette: value as TextCoverRecipe['palette'] })}
        />
        <CoverSelect
          label={copy.decoration}
          value={recipe.decoration}
          choices={textCoverDecorations.map((id) => ({ id, label: copy.decorations[id] }))}
          onChange={(value) => onChange({ ...recipe, decoration: value as TextCoverRecipe['decoration'] })}
        />
        <CoverSelect
          label={copy.weight}
          value={String(recipe.weight)}
          choices={[
            { id: '400', label: copy.regular },
            { id: '500', label: copy.medium },
            { id: '600', label: copy.semibold },
            { id: '700', label: copy.bold },
            { id: '800', label: copy.heavy },
          ]}
          onChange={(value) => onChange({ ...recipe, weight: Number(value) })}
        />
      </div>
      <CoverSelect
        label={copy.font}
        value={recipe.font}
        choices={fontChoices}
        onChange={(value) => onChange({ ...recipe, font: value })}
      />
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="w-fit px-0">
            <InfoIcon className="size-3.5" />
            {copy.fontGuide}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 space-y-3 text-xs leading-relaxed">
          <p>{copy.fontAdvice}</p>
          <p>{copy.fontLicense}</p>
          <p>{copy.fontFallback}</p>
        </PopoverContent>
      </Popover>
    </div>
  );
}

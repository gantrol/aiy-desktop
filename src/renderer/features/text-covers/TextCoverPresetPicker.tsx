import { Button } from '@/renderer/components/ui/button';
import { TextCoverPreview } from '@/renderer/features/text-covers/TextCoverPreview';
import { textCoverPresets, type TextCoverRecipe } from '@/renderer/features/text-covers/textCoverPresets';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ArticleCoverRatio } from '@/shared/article-covers';

export function TextCoverPresetPicker({
  title,
  seed,
  ratio,
  recipe,
  onChange,
}: {
  title: string;
  seed: string;
  ratio: ArticleCoverRatio;
  recipe: TextCoverRecipe;
  onChange(recipe: TextCoverRecipe): void;
}) {
  const copy = useI18n().messages.contentEditor.textCover;
  return (
    <div className="flex gap-2 overflow-x-auto pb-2" role="group" aria-label={copy.templates}>
      {textCoverPresets.map((preset) => (
        <Button
          key={preset.id}
          type="button"
          variant="ghost"
          className="h-auto w-28 shrink-0 flex-col gap-1 rounded-sm p-1 aria-pressed:bg-selected aria-pressed:text-selected-foreground"
          aria-pressed={Object.keys(recipe)
            .filter((key) => key !== 'id')
            .every((key) => recipe[key as keyof TextCoverRecipe] === preset[key as keyof TextCoverRecipe])}
          onClick={() => onChange({ ...preset })}
        >
          <TextCoverPreview title={title} seed={seed} recipe={preset} ratio={ratio} className="w-full" />
          <span className="text-xs">{copy.presets[preset.id]}</span>
        </Button>
      ))}
    </div>
  );
}

import { useId } from 'react';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import {
  articleUploadTargetKey,
  type ArticleDeliveryPreferences,
  type ArticleUploadTarget,
} from '@/renderer/features/article-delivery/articleDeliveryPreferences';

export function selectArticleDeliveryTargets(
  current: ArticleDeliveryPreferences,
  targets: readonly ArticleUploadTarget[],
  selected: boolean,
): ArticleDeliveryPreferences {
  const keys = new Set(targets.map(articleUploadTargetKey));
  if (!selected)
    return { ...current, targets: current.targets.filter((target) => !keys.has(articleUploadTargetKey(target))) };
  const result = new Map(current.targets.map((target) => [articleUploadTargetKey(target), target]));
  for (const target of targets) {
    const key = articleUploadTargetKey(target);
    if (!result.has(key) && result.size < 32) result.set(key, target);
  }
  return { ...current, targets: [...result.values()] };
}

export function ArticleDeliverySelectAll({
  label,
  targets,
  preferences,
  disabled,
  onChange,
  showLabel = true,
}: {
  label: string;
  targets: readonly ArticleUploadTarget[];
  preferences: ArticleDeliveryPreferences;
  disabled: boolean;
  onChange(targets: readonly ArticleUploadTarget[], selected: boolean): void;
  showLabel?: boolean;
}) {
  const id = useId();
  const selected = new Set(preferences.targets.map(articleUploadTargetKey));
  const count = targets.filter((target) => selected.has(articleUploadTargetKey(target))).length;
  const all = targets.length > 0 && count === targets.length;
  return (
    <div className="flex min-h-8 items-center gap-3">
      <label htmlFor={id} className={showLabel ? 'min-w-0 flex-1 cursor-pointer text-sm font-medium' : 'sr-only'}>
        {label}
      </label>
      <Checkbox
        id={id}
        title={label}
        checked={all ? true : count > 0 ? 'indeterminate' : false}
        disabled={disabled || !targets.length || (!count && preferences.targets.length >= 32)}
        onCheckedChange={() => onChange(targets, !all)}
      />
    </div>
  );
}

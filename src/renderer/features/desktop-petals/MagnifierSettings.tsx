import { Label } from '@/renderer/components/ui/label';
import { PetalSelect } from '@/renderer/features/desktop-petals/PetalControls';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  screenMagnifierSettingsSchema,
  type ScreenMagnifierSettings,
  type ScreenMagnifierState,
} from '@/shared/contracts/screen-magnifier';

export function MagnifierSettings({
  settings,
  state,
  onChange,
}: {
  settings?: ScreenMagnifierSettings;
  state?: ScreenMagnifierState;
  onChange(value: ScreenMagnifierSettings): void;
}) {
  const { messages } = useI18n();
  const copy = messages.desktopPetals.magnifier;
  const value = screenMagnifierSettingsSchema.parse(settings ?? {});
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>{copy.scale}</Label>
        <PetalSelect
          label={copy.scale}
          value={String(value.scale)}
          options={[1.5, 2, 3, 4].map((scale) => ({ value: String(scale), label: `${scale}×` }))}
          onChange={(scale) => onChange(screenMagnifierSettingsSchema.parse({ ...value, scale: Number(scale) }))}
        />
      </div>
      <div className="space-y-1">
        <Label>{copy.size}</Label>
        <PetalSelect
          label={copy.size}
          value={value.size}
          options={(['small', 'medium', 'large'] as const).map((size) => ({ value: size, label: copy.sizes[size] }))}
          onChange={(size) => onChange(screenMagnifierSettingsSchema.parse({ ...value, size }))}
        />
      </div>
      {state?.availability !== 'ready' && (
        <div role="status" className="text-xs text-muted-foreground">
          {state?.availability === 'unsupported'
            ? messages.desktopPetals.errors.magnifierUnsupported
            : messages.desktopPetals.errors.magnifierDisabled}
        </div>
      )}
    </div>
  );
}

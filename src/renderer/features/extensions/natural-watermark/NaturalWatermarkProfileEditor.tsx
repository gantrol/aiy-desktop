import { LoaderCircleIcon, UploadIcon } from 'lucide-react';
import {
  NATURAL_WATERMARK_MAX_JITTER_RATIO,
  NATURAL_WATERMARK_MAX_SIZE_RATIO,
  NATURAL_WATERMARK_MIN_SIZE_RATIO,
  NATURAL_WATERMARK_PROFILE_NAME_MAX_LENGTH,
  NATURAL_WATERMARK_TEXT_MAX_LENGTH,
  type NaturalWatermarkBrand,
  type NaturalWatermarkProfile,
} from '@/shared/contracts/natural-watermark';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Field, FieldControl, FieldError, FieldLabel } from '@/renderer/components/ui/field';
import { Input } from '@/renderer/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Slider } from '@/renderer/components/ui/slider';
import { clampNaturalWatermarkRatio } from '@/renderer/features/extensions/natural-watermark-editor-model';

function presetText(brand: NaturalWatermarkBrand) {
  return brand === 'AIY' ? 'AIY' : 'AICanDo.XYZ';
}

function RatioField({
  id,
  label,
  value,
  minimum,
  maximum,
  step,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  disabled: boolean;
  onChange(value: number): void;
}) {
  const percentage = Number((value * 100).toFixed(step < 1 ? 1 : 0));
  const minimumPercentage = minimum * 100;
  const maximumPercentage = maximum * 100;
  return (
    <Field id={id}>
      <div className="flex items-center justify-between gap-3">
        <FieldLabel>{label}</FieldLabel>
        <Input
          type="number"
          className="h-8 w-20 text-right text-xs tabular-nums"
          aria-label={`${label} %`}
          min={minimumPercentage}
          max={maximumPercentage}
          step={step}
          value={percentage}
          disabled={disabled}
          onChange={(event) => {
            const next = event.currentTarget.valueAsNumber;
            if (Number.isFinite(next)) onChange(clampNaturalWatermarkRatio(next / 100, minimum, maximum));
          }}
        />
      </div>
      <FieldControl>
        <Slider
          min={minimumPercentage}
          max={maximumPercentage}
          step={step}
          value={[percentage]}
          disabled={disabled}
          onValueChange={([next]) => {
            if (next !== undefined) onChange(next / 100);
          }}
        />
      </FieldControl>
    </Field>
  );
}

export function NaturalWatermarkProfileEditor({
  profile,
  disabled,
  importing,
  duplicateName,
  zh,
  onChange,
  onImportLogo,
}: {
  profile: NaturalWatermarkProfile;
  disabled: boolean;
  importing: boolean;
  duplicateName: boolean;
  zh: boolean;
  onChange(profile: NaturalWatermarkProfile): void;
  onImportLogo(): void;
}) {
  function selectBuiltInBrand(brand: NaturalWatermarkBrand) {
    const previousDefault = profile.logo.kind === 'BUILT_IN' ? presetText(profile.logo.brand) : null;
    onChange({
      ...profile,
      logo: { kind: 'BUILT_IN', brand },
      text: profile.text === previousDefault ? presetText(brand) : profile.text,
    });
  }

  const nameInvalid = !profile.name.trim() || duplicateName;
  const nameError = !profile.name.trim()
    ? zh
      ? '名称不能为空'
      : 'Name is required'
    : duplicateName
      ? zh
        ? '名称已存在'
        : 'Name already exists'
      : '';

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="natural-watermark-name" invalid={nameInvalid}>
          <FieldLabel>{zh ? '名称' : 'Name'}</FieldLabel>
          <FieldControl>
            <Input
              value={profile.name}
              maxLength={NATURAL_WATERMARK_PROFILE_NAME_MAX_LENGTH}
              disabled={disabled}
              onChange={(event) => onChange({ ...profile, name: event.currentTarget.value })}
            />
          </FieldControl>
          <FieldError>{nameError}</FieldError>
        </Field>
        <Field id="natural-watermark-brand">
          <FieldLabel>{zh ? '标识' : 'Mark'}</FieldLabel>
          <div className="flex gap-2">
            <Select
              value={profile.logo.kind === 'BUILT_IN' ? profile.logo.brand : 'CUSTOM'}
              disabled={disabled}
              onValueChange={(brand) => {
                if (brand === 'AIY' || brand === 'AICANDO_XYZ') selectBuiltInBrand(brand);
              }}
            >
              <FieldControl>
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                <SelectItem value="AIY">AIY</SelectItem>
                <SelectItem value="AICANDO_XYZ">AICanDo.XYZ</SelectItem>
                {profile.logo.kind === 'CUSTOM' && <SelectItem value="CUSTOM">{zh ? '自定义' : 'Custom'}</SelectItem>}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0"
              disabled={disabled}
              onClick={onImportLogo}
            >
              {importing ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : <UploadIcon className="size-3.5" />}
              {zh ? '上传' : 'Upload'}
            </Button>
          </div>
        </Field>
        <Field id="natural-watermark-text" className="sm:col-span-2">
          <FieldLabel>{zh ? '文字' : 'Text'}</FieldLabel>
          <FieldControl>
            <Input
              value={profile.text}
              maxLength={NATURAL_WATERMARK_TEXT_MAX_LENGTH}
              disabled={disabled}
              onChange={(event) => onChange({ ...profile, text: event.currentTarget.value })}
            />
          </FieldControl>
        </Field>
      </div>

      <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
        <RatioField
          id="natural-watermark-size"
          label={zh ? '尺寸' : 'Size'}
          value={profile.sizeRatio}
          minimum={NATURAL_WATERMARK_MIN_SIZE_RATIO}
          maximum={NATURAL_WATERMARK_MAX_SIZE_RATIO}
          step={0.5}
          disabled={disabled}
          onChange={(sizeRatio) => onChange({ ...profile, sizeRatio })}
        />
        <RatioField
          id="natural-watermark-opacity"
          label={zh ? '强度' : 'Strength'}
          value={profile.opacity}
          minimum={0.35}
          maximum={0.95}
          step={1}
          disabled={disabled}
          onChange={(opacity) => onChange({ ...profile, opacity })}
        />
      </div>

      <div className="grid gap-4 border-t pt-4">
        <span className="text-sm font-semibold">{zh ? '位置' : 'Position'}</span>
        <div className="grid gap-4 sm:grid-cols-2">
          <RatioField
            id="natural-watermark-position-x"
            label="X"
            value={profile.position.x}
            minimum={0}
            maximum={1}
            step={1}
            disabled={disabled}
            onChange={(x) => onChange({ ...profile, position: { ...profile.position, x } })}
          />
          <RatioField
            id="natural-watermark-position-y"
            label="Y"
            value={profile.position.y}
            minimum={0}
            maximum={1}
            step={1}
            disabled={disabled}
            onChange={(y) => onChange({ ...profile, position: { ...profile.position, y } })}
          />
        </div>
        <label className="flex min-h-8 cursor-pointer items-center gap-2 text-sm font-medium">
          <Checkbox
            checked={profile.positionJitter.enabled}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onChange({
                ...profile,
                positionJitter: { ...profile.positionJitter, enabled: checked === true },
              })
            }
          />
          {zh ? '随机波动' : 'Position jitter'}
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <RatioField
            id="natural-watermark-jitter-x"
            label={zh ? '横向波动' : 'Horizontal jitter'}
            value={profile.positionJitter.x}
            minimum={0}
            maximum={NATURAL_WATERMARK_MAX_JITTER_RATIO}
            step={1}
            disabled={disabled || !profile.positionJitter.enabled}
            onChange={(x) => onChange({ ...profile, positionJitter: { ...profile.positionJitter, x } })}
          />
          <RatioField
            id="natural-watermark-jitter-y"
            label={zh ? '纵向波动' : 'Vertical jitter'}
            value={profile.positionJitter.y}
            minimum={0}
            maximum={NATURAL_WATERMARK_MAX_JITTER_RATIO}
            step={1}
            disabled={disabled || !profile.positionJitter.enabled}
            onChange={(y) => onChange({ ...profile, positionJitter: { ...profile.positionJitter, y } })}
          />
        </div>
      </div>
    </div>
  );
}

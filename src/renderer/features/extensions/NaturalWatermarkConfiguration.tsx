import { useEffect, useState } from 'react';
import {
  ArrowDownLeftIcon,
  ArrowDownRightIcon,
  ArrowUpLeftIcon,
  ArrowUpRightIcon,
  ImageIcon,
  LoaderCircleIcon,
  UploadIcon,
} from 'lucide-react';
import {
  NATURAL_WATERMARK_TEXT_MAX_LENGTH,
  type NaturalWatermarkBrand,
  type NaturalWatermarkConfiguration,
  type NaturalWatermarkPlacement,
} from '@/shared/contracts/natural-watermark';
import { Button } from '@/renderer/components/ui/button';
import { Field, FieldControl, FieldLabel } from '@/renderer/components/ui/field';
import { Input } from '@/renderer/components/ui/input';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Slider } from '@/renderer/components/ui/slider';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import aicandoMarkUrl from '../../../../extensions/com.aiy.natural-watermark/assets/aicando-mark.svg?url';

const placementIcons = {
  TOP_LEFT: ArrowUpLeftIcon,
  TOP_RIGHT: ArrowUpRightIcon,
  BOTTOM_LEFT: ArrowDownLeftIcon,
  BOTTOM_RIGHT: ArrowDownRightIcon,
} as const satisfies Record<NaturalWatermarkPlacement, typeof ArrowUpLeftIcon>;

function presetText(brand: NaturalWatermarkBrand) {
  return brand === 'AIY' ? 'AIY' : 'AICanDo.XYZ';
}

function BrandLockup({
  configuration,
  customLogoUrl,
  dark,
}: {
  configuration: NaturalWatermarkConfiguration;
  customLogoUrl: string | null;
  dark: boolean;
}) {
  const ink = dark ? 'text-media-checker-a' : 'text-media-surround-dark';
  const style = configuration.logo.kind === 'BUILT_IN' ? configuration.logo.brand : 'CUSTOM';
  return (
    <span className={cn('flex items-center gap-1.5 text-sm font-bold tracking-tight', ink)}>
      {style === 'AIY' ? (
        <img src="./icon.png" alt="" className="size-7 rounded-sm" />
      ) : style === 'AICANDO_XYZ' ? (
        <img src={aicandoMarkUrl} alt="" className="size-7" />
      ) : customLogoUrl ? (
        <img src={customLogoUrl} alt="" className="h-7 max-w-16 object-contain" />
      ) : (
        <ImageIcon className="size-7" aria-hidden="true" />
      )}
      {configuration.text && <span className="max-w-56 truncate">{configuration.text}</span>}
    </span>
  );
}

function WatermarkPreview({
  configuration,
  customLogoUrl,
}: {
  configuration: NaturalWatermarkConfiguration;
  customLogoUrl: string | null;
}) {
  const left = configuration.placement === 'TOP_LEFT' || configuration.placement === 'BOTTOM_LEFT';
  const top = configuration.placement === 'TOP_LEFT' || configuration.placement === 'TOP_RIGHT';
  return (
    <div className="relative h-36 overflow-hidden rounded-md border bg-media-surround-dark">
      <div className="absolute inset-y-0 right-0 w-1/2 bg-media-surround-light" />
      <div
        className={cn(
          'absolute m-3 rounded-sm px-1.5 py-1 shadow-overlay',
          left ? 'left-0' : 'right-0',
          top ? 'top-0' : 'bottom-0',
          left ? 'bg-media-surround-dark/30' : 'bg-media-checker-a/40',
        )}
        style={{ opacity: configuration.opacity }}
      >
        <BrandLockup configuration={configuration} customLogoUrl={customLogoUrl} dark={left} />
      </div>
    </div>
  );
}

export function NaturalWatermarkConfigurationPanel({
  active,
  notify,
}: {
  active: boolean;
  notify(message: string): void;
}) {
  const { locale } = useI18n();
  const zh = locale === 'zh';
  const [configuration, setConfiguration] = useState<NaturalWatermarkConfiguration | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [customLogoUrl, setCustomLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void window.desktopApi
      .naturalWatermarkConfigurationGet()
      .then((value) => {
        if (current) setConfiguration(value);
      })
      .catch((reason) => {
        if (current) notify(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      current = false;
    };
  }, [notify]);

  const customLogoId = configuration?.logo.kind === 'CUSTOM' ? configuration.logo.id : null;
  useEffect(() => {
    let current = true;
    let objectUrl: string | null = null;
    setCustomLogoUrl(null);
    if (customLogoId) {
      void window.desktopApi
        .naturalWatermarkCustomLogoGet(customLogoId)
        .then((logo) => {
          objectUrl = URL.createObjectURL(new Blob([Uint8Array.from(logo.bytes)], { type: logo.mimeType }));
          if (current) setCustomLogoUrl(objectUrl);
          else URL.revokeObjectURL(objectUrl);
        })
        .catch((reason) => {
          if (current) notify(reason instanceof Error ? reason.message : String(reason));
        });
    }
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [customLogoId, notify]);

  if (!configuration) {
    return (
      <div className="grid h-24 place-items-center border-y">
        <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  async function save() {
    if (!configuration || saving || importing) return;
    setSaving(true);
    try {
      setConfiguration(await window.desktopApi.naturalWatermarkConfigurationSave(configuration));
      notify(zh ? '水印设置已保存' : 'Watermark settings saved');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  function selectBuiltInBrand(brand: NaturalWatermarkBrand) {
    if (!configuration) return;
    const previousDefault = configuration.logo.kind === 'BUILT_IN' ? presetText(configuration.logo.brand) : null;
    setConfiguration({
      ...configuration,
      logo: { kind: 'BUILT_IN', brand },
      text: configuration.text === previousDefault ? presetText(brand) : configuration.text,
    });
  }

  async function importCustomLogo() {
    if (!configuration || importing || saving) return;
    setImporting(true);
    try {
      const logo = await window.desktopApi.naturalWatermarkCustomLogoImport();
      if (!logo) return;
      setConfiguration({ ...configuration, logo: { kind: 'CUSTOM', id: logo.id } });
      notify(zh ? '已载入自定义标识' : 'Custom logo loaded');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setImporting(false);
    }
  }

  const controlsDisabled = !active || saving || importing;

  return (
    <section className="grid gap-5 border-y py-5">
      <WatermarkPreview configuration={configuration} customLogoUrl={customLogoUrl} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="natural-watermark-brand">
          <FieldLabel>{zh ? '标识' : 'Brand'}</FieldLabel>
          <div className="flex gap-2">
            <Select
              value={configuration.logo.kind === 'BUILT_IN' ? configuration.logo.brand : 'CUSTOM'}
              disabled={controlsDisabled}
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
                {configuration.logo.kind === 'CUSTOM' && (
                  <SelectItem value="CUSTOM">{zh ? '自定义' : 'Custom'}</SelectItem>
                )}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0"
              disabled={controlsDisabled}
              onClick={() => void importCustomLogo()}
            >
              {importing ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : <UploadIcon className="size-3.5" />}
              {zh ? '上传' : 'Upload'}
            </Button>
          </div>
        </Field>
        <Field id="natural-watermark-text">
          <FieldLabel>{zh ? '文字' : 'Text'}</FieldLabel>
          <FieldControl>
            <Input
              value={configuration.text}
              maxLength={NATURAL_WATERMARK_TEXT_MAX_LENGTH}
              disabled={controlsDisabled}
              onChange={(event) => setConfiguration({ ...configuration, text: event.currentTarget.value })}
            />
          </FieldControl>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="natural-watermark-placement">
          <FieldLabel>{zh ? '位置' : 'Position'}</FieldLabel>
          <FieldControl>
            <Segmented
              type="single"
              value={configuration.placement}
              disabled={controlsDisabled}
              className="w-fit"
              onValueChange={(placement: NaturalWatermarkPlacement) => {
                if (placement) setConfiguration({ ...configuration, placement });
              }}
            >
              {(Object.keys(placementIcons) as NaturalWatermarkPlacement[]).map((placement) => {
                const Icon = placementIcons[placement];
                return (
                  <SegmentedItem
                    key={placement}
                    value={placement}
                    className="w-9 px-0"
                    aria-label={placement.toLowerCase().replace('_', ' ')}
                    title={placement.toLowerCase().replace('_', ' ')}
                  >
                    <Icon className="size-3.5" />
                  </SegmentedItem>
                );
              })}
            </Segmented>
          </FieldControl>
        </Field>
        <Field id="natural-watermark-opacity">
          <div className="flex items-center justify-between gap-3">
            <FieldLabel>{zh ? '强度' : 'Strength'}</FieldLabel>
            <span className="text-xs tabular-nums text-muted-foreground">
              {Math.round(configuration.opacity * 100)}%
            </span>
          </div>
          <FieldControl>
            <Slider
              min={35}
              max={95}
              step={1}
              value={[Math.round(configuration.opacity * 100)]}
              disabled={controlsDisabled}
              onValueChange={([opacity]) => {
                if (opacity !== undefined) setConfiguration({ ...configuration, opacity: opacity / 100 });
              }}
            />
          </FieldControl>
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="button" size="sm" disabled={controlsDisabled} onClick={() => void save()}>
          {saving && <LoaderCircleIcon className="size-3.5 animate-spin" />}
          {zh ? '保存' : 'Save'}
        </Button>
      </div>
    </section>
  );
}

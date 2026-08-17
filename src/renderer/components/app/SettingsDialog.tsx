import { ArrowRightIcon } from 'lucide-react';
import type { Locale } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { Label } from '@/renderer/components/ui/label';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { AppUpdateSection } from '@/renderer/features/app-update/AppUpdateSection';

interface Props {
  promptLocale: Locale | null;
  open: boolean;
  onOpenChange(open: boolean): void;
  onPromptLocaleChange(locale: Locale | null): void;
  onAiFeatureModelsOpen(): void;
}

export function SettingsDialog({
  promptLocale,
  open,
  onOpenChange,
  onPromptLocaleChange,
  onAiFeatureModelsOpen,
}: Props) {
  const { locale, setLocale, messages, availableLocales } = useI18n();
  const l = messages.app.settings;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{l.title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>{l.interfaceLanguage}</Label>
            <Segmented
              type="single"
              value={locale}
              onValueChange={(value) => value && setLocale(value as Locale)}
              className="grid grid-cols-2"
            >
              <SegmentedItem value="zh" disabled={!availableLocales.includes('zh')}>
                {l.chinese}
              </SegmentedItem>
              <SegmentedItem value="en" disabled={!availableLocales.includes('en')}>
                {l.english}
              </SegmentedItem>
            </Segmented>
          </div>
          <div className="grid gap-2">
            <Label>{l.promptLanguage}</Label>
            <Segmented
              type="single"
              value={promptLocale ?? 'none'}
              onValueChange={(value) => value && onPromptLocaleChange(value === 'none' ? null : (value as Locale))}
              className="grid grid-cols-3"
            >
              <SegmentedItem value="none">{l.none}</SegmentedItem>
              <SegmentedItem value="zh">{l.chinese}</SegmentedItem>
              <SegmentedItem value="en">{l.english}</SegmentedItem>
            </Segmented>
          </div>
          <div className="grid gap-2">
            <Label>{l.aiFeatureModels}</Label>
            <Button
              type="button"
              variant="outline"
              className="justify-between"
              onClick={() => {
                onOpenChange(false);
                onAiFeatureModelsOpen();
              }}
            >
              {l.manageAiFeatureModels}
              <ArrowRightIcon className="size-4" />
            </Button>
          </div>
          <AppUpdateSection active={open} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

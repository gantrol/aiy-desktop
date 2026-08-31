import { ArrowRightIcon, ExternalLinkIcon } from 'lucide-react';
import { useState } from 'react';
import type { AppSupportDestination, Locale } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { Label } from '@/renderer/components/ui/label';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { AppUpdateSection } from '@/renderer/features/app-update/AppUpdateSection';
import { KeyboardShortcutsSettings } from '@/renderer/components/app/KeyboardShortcutsSettings';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';

interface Props {
  promptLocale: Locale | null;
  open: boolean;
  onOpenChange(open: boolean): void;
  onPromptLocaleChange(locale: Locale | null): void;
  onAiFeatureModelsOpen(): void;
  onContentManagementOpen(): void;
}

export function SettingsDialog({
  promptLocale,
  open,
  onOpenChange,
  onPromptLocaleChange,
  onAiFeatureModelsOpen,
  onContentManagementOpen,
}: Props) {
  const { locale, setLocale, messages, availableLocales } = useI18n();
  const l = messages.app.settings;
  const [supportError, setSupportError] = useState('');
  const [page, setPage] = useState('general');

  async function openSupportDestination(destination: AppSupportDestination) {
    setSupportError('');
    try {
      await window.desktopApi.appSupportOpen(destination);
    } catch {
      setSupportError(l.supportOpenFailed);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={page === 'shortcuts' ? 'max-w-4xl' : 'max-w-sm'}>
        <DialogHeader>
          <DialogTitle>{l.title}</DialogTitle>
        </DialogHeader>
        <Tabs value={page} onValueChange={setPage} className="gap-4">
          <TabsList>
            <TabsTrigger value="general">{locale === 'zh' ? '常规' : 'General'}</TabsTrigger>
            <TabsTrigger value="shortcuts">{locale === 'zh' ? '快捷键' : 'Shortcuts'}</TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="grid gap-4">
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
            <div className="grid gap-2">
              <Label>{l.content}</Label>
              <Button
                type="button"
                variant="outline"
                className="justify-between"
                onClick={() => {
                  onOpenChange(false);
                  onContentManagementOpen();
                }}
              >
                {l.manageContent}
                <ArrowRightIcon className="size-4" />
              </Button>
            </div>
            <div className="grid gap-1 border-t pt-2">
              <AppUpdateSection active={open} />
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-8 w-fit px-1.5 text-xs text-muted-foreground"
                onClick={() => void openSupportDestination('PRIVACY_POLICY')}
              >
                {l.privacyPolicy}
                <ExternalLinkIcon className="size-3.5" />
              </Button>
              {supportError && (
                <p role="alert" className="px-1.5 text-xs text-destructive">
                  {supportError}
                </p>
              )}
            </div>
          </TabsContent>
          <TabsContent value="shortcuts">
            <KeyboardShortcutsSettings locale={locale} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

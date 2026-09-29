import { ArrowRightIcon } from 'lucide-react';
import { useState } from 'react';
import type { Locale } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { Label } from '@/renderer/components/ui/label';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import {
  setBracketAssociationsEnabled,
  useBracketAssociations,
} from '@/renderer/features/content-editor/contentAssociationPreferences';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { KeyboardShortcutsSettings } from '@/renderer/components/app/KeyboardShortcutsSettings';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { PetalMaintenance } from '@/renderer/features/desktop-petals/PetalMaintenance';
import { AgentPermissionsSettings } from '@/renderer/features/agent-permissions/AgentPermissionsSettings';
import { FontSettings } from '@/renderer/features/font-settings/FontSettings';

interface Props {
  promptLocale: Locale | null;
  onPromptLocaleChange(locale: Locale | null): void;
  onAiFeatureModelsOpen(): void;
  onContentManagementOpen(): void;
}

export function SettingsScreen({
  promptLocale,
  onPromptLocaleChange,
  onAiFeatureModelsOpen,
  onContentManagementOpen,
}: Props) {
  const { locale, setLocale, messages, availableLocales } = useI18n();
  const l = messages.app.settings;
  const [page, setPage] = useState('general');
  const bracketAssociations = useBracketAssociations();

  return (
    <div className="h-full overflow-y-auto">
      <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
        <h1 className="text-xl font-semibold">{l.title}</h1>
        <Tabs value={page} onValueChange={setPage} className="gap-4">
          <TabsList className="flex-wrap justify-start">
            <TabsTrigger value="general">{l.generalTab}</TabsTrigger>
            <TabsTrigger value="fonts">{l.fonts.tab}</TabsTrigger>
            <TabsTrigger value="shortcuts">{l.shortcutsTab}</TabsTrigger>
            <TabsTrigger value="maintenance">{l.maintenanceTab}</TabsTrigger>
            <TabsTrigger value="cli">{messages.agentPermissions.tab}</TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="grid max-w-xl gap-6">
            <div className="grid gap-2">
              <Label>{messages.contentEditor.association.editing}</Label>
              <Label className="flex items-center gap-2 font-normal">
                <Checkbox
                  checked={bracketAssociations}
                  onCheckedChange={(checked) => setBracketAssociationsEnabled(checked === true)}
                />
                {messages.contentEditor.association.automatic}
              </Label>
            </div>
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
                  onContentManagementOpen();
                }}
              >
                {l.manageContent}
                <ArrowRightIcon className="size-4" />
              </Button>
            </div>
          </TabsContent>
          <TabsContent value="shortcuts">
            <KeyboardShortcutsSettings />
          </TabsContent>
          <TabsContent value="fonts">{page === 'fonts' && <FontSettings />}</TabsContent>
          <TabsContent value="maintenance">
            <PetalMaintenance />
          </TabsContent>
          <TabsContent value="cli">{page === 'cli' && <AgentPermissionsSettings />}</TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

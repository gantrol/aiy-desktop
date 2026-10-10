import { ArrowUpRightIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
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
import { SettingsLayout, type SettingsArea } from '@/renderer/components/app/SettingsLayout';
import { PetalMaintenance } from '@/renderer/features/desktop-petals/PetalMaintenance';
import { AgentPermissionsSettings } from '@/renderer/features/agent-permissions/AgentPermissionsSettings';
import { FontSettings } from '@/renderer/features/font-settings/FontSettings';
import { cn } from '@/renderer/lib/utils';

export interface SettingsScreenProps {
  promptLocale: Locale | null;
  onPromptLocaleChange(locale: Locale | null): void;
  onAiFeatureModelsOpen(): void;
  onContentManagementOpen(): void;
  contentManagement?: ReactNode;
  onSettingsOpen?(): void;
}

export function SettingsScreen(props: SettingsScreenProps) {
  const { messages } = useI18n();
  const labels = messages.app.settings;
  const panelId = useId();
  const [area, setArea] = useState<SettingsArea>('interface');
  const [visited, setVisited] = useState<SettingsArea[]>(['interface']);
  const titles: Record<SettingsArea, string> = {
    interface: labels.layout.interface,
    editor: labels.layout.editor,
    ai: labels.layout.ai,
    shortcuts: labels.shortcutsTab,
    maintenance: labels.maintenanceTab,
    permissions: messages.agentPermissions.tab,
  };

  return (
    <div className="@container/settings flex size-full min-h-0 flex-col bg-background">
      <header className="flex min-h-14 shrink-0 items-center border-b px-6 py-3">
        <h1 className="text-base font-semibold">{labels.title}</h1>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto @[56rem]/settings:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)] @[56rem]/settings:overflow-hidden">
        <div className="min-w-0 @[56rem]/settings:overflow-y-auto">
          <SettingsLayout
            selected={props.contentManagement ? 'contentManagement' : area}
            panelId={panelId}
            onSelect={(next) => {
              setArea(next);
              setVisited((current) => (current.includes(next) ? current : [...current, next]));
              if (props.contentManagement) props.onSettingsOpen?.();
            }}
            onContentManagementOpen={props.onContentManagementOpen}
          />
        </div>
        <div
          className={cn(
            'min-w-0 border-t @[56rem]/settings:border-t-0 @[56rem]/settings:border-l',
            props.contentManagement
              ? 'flex min-h-[28rem] flex-col @[56rem]/settings:min-h-0'
              : 'p-5 @[56rem]/settings:overflow-y-auto @[56rem]/settings:p-6',
          )}
        >
          {(Object.keys(titles) as SettingsArea[]).map((item) => (
            <section
              key={item}
              id={panelId + '-' + item}
              aria-labelledby={panelId + '-' + item + '-title'}
              hidden={item !== area || Boolean(props.contentManagement)}
              className={item === area && !props.contentManagement ? 'grid w-full max-w-2xl gap-6' : 'hidden'}
            >
              <h2 id={panelId + '-' + item + '-title'} className="text-sm font-semibold">
                {titles[item]}
              </h2>
              {visited.includes(item) && <SettingsAreaContent area={item} {...props} />}
            </section>
          ))}
          {props.contentManagement && (
            <section
              id={`${panelId}-contentManagement`}
              className="flex min-h-0 flex-1 flex-col"
              aria-label={labels.manageContent}
            >
              {props.contentManagement}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsAreaContent({
  area,
  promptLocale,
  onPromptLocaleChange,
  onAiFeatureModelsOpen,
}: SettingsScreenProps & { area: SettingsArea }) {
  const { locale, setLocale, messages, availableLocales } = useI18n();
  const labels = messages.app.settings;
  const bracketAssociations = useBracketAssociations();

  switch (area) {
    case 'interface':
      return (
        <>
          <div className="grid grid-cols-[minmax(5rem,1fr)_minmax(0,2fr)] items-center gap-4">
            <Label>{labels.interfaceLanguage}</Label>
            <Segmented
              type="single"
              value={locale}
              aria-label={labels.interfaceLanguage}
              onValueChange={(value) => value && setLocale(value as Locale)}
              className="grid grid-cols-2"
            >
              <SegmentedItem value="zh" disabled={!availableLocales.includes('zh')}>
                {labels.chinese}
              </SegmentedItem>
              <SegmentedItem value="en" disabled={!availableLocales.includes('en')}>
                {labels.english}
              </SegmentedItem>
            </Segmented>
          </div>
          <FontSettings roles={['ui']} />
        </>
      );
    case 'editor':
      return (
        <>
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox
              checked={bracketAssociations}
              onCheckedChange={(checked) => setBracketAssociationsEnabled(checked === true)}
            />
            {messages.contentEditor.association.automatic}
          </Label>
          <FontSettings roles={['content', 'mono']} />
        </>
      );
    case 'ai':
      return (
        <>
          <div className="grid gap-2">
            <Label>{labels.promptLanguage}</Label>
            <Segmented
              type="single"
              value={promptLocale ?? 'none'}
              aria-label={labels.promptLanguage}
              onValueChange={(value) => value && onPromptLocaleChange(value === 'none' ? null : (value as Locale))}
              className="grid grid-cols-3"
            >
              <SegmentedItem value="none">{labels.none}</SegmentedItem>
              <SegmentedItem value="zh">{labels.chinese}</SegmentedItem>
              <SegmentedItem value="en">{labels.english}</SegmentedItem>
            </Segmented>
          </div>
          <Button type="button" variant="outline" className="justify-between" onClick={onAiFeatureModelsOpen}>
            {labels.manageAiFeatureModels}
            <ArrowUpRightIcon className="size-4" aria-hidden="true" />
          </Button>
        </>
      );
    case 'shortcuts':
      return <KeyboardShortcutsSettings />;
    case 'maintenance':
      return <PetalMaintenance />;
    case 'permissions':
      return <AgentPermissionsSettings />;
  }
}

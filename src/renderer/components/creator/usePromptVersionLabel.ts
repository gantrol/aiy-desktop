import type { PromptVersionDto } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';

export function usePromptVersionLabel() {
  const labels = useI18n().messages.creator.workbench;
  return (version: Pick<PromptVersionDto, 'versionNo' | 'changeSummary'>) => {
    const number = `V${String(version.versionNo).padStart(2, '0')}`;
    const summary = version.changeSummary;
    const localized =
      summary === 'EXTERNAL_IMPORT'
        ? labels.externalVersion
        : summary === 'MANUAL_PROMPT'
          ? labels.manualVersion
          : summary === '初始版本' || summary === 'Initial'
            ? version.versionNo === 1
              ? labels.initialVersion
              : ''
            : summary;
    return localized ? `${number} · ${localized}` : number;
  };
}

import { WorkbenchPaneToggle } from '@/renderer/components/workbench/WorkbenchPane';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ResultLibraryMode } from '@/renderer/components/creator/ResultLibrary';

interface Props {
  mode: ResultLibraryMode;
}

export function CreationLibraryPaneToggle({
  mode,
  visible,
  canExpand,
  onModeChange,
}: Props & {
  visible: boolean;
  canExpand: boolean;
  onModeChange(mode: ResultLibraryMode): void;
}) {
  const label = useI18n().messages.workbench.creationList;
  if (!visible) return null;
  const expanded = mode !== 'images';
  return (
    <WorkbenchPaneToggle
      floating={false}
      expanded={expanded}
      label={label}
      data-action={expanded ? 'collapse-creation-library' : 'expand-creation-library'}
      disabled={!expanded && !canExpand}
      onClick={() => onModeChange(expanded ? 'images' : 'full')}
    />
  );
}

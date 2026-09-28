import { ListTreeIcon, ListChecksIcon } from 'lucide-react';
import { WorkbenchViewMenu } from '@/renderer/components/workbench/WorkbenchViewMenu';
import { WorkbenchPaneToggle } from '@/renderer/components/workbench/WorkbenchPane';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ResultLibraryMode } from '@/renderer/components/creator/ResultLibrary';

interface Props {
  mode: ResultLibraryMode;
  expandedMode: 'full' | 'outline';
}

export function CreationLibraryViewMenu({
  mode,
  expandedMode,
  onOutline,
  onList,
}: Props & { onOutline(): void; onList(): void }) {
  const copy = useI18n().messages.workbench;
  return (
    <WorkbenchViewMenu
      value={mode === 'images' ? expandedMode : mode}
      label={copy.view}
      options={[
        { id: 'full', label: copy.creationList, icon: ListTreeIcon },
        { id: 'outline', label: copy.creationOutline, icon: ListChecksIcon },
      ]}
      onValueChange={(value) => {
        if (value === 'outline') onOutline();
        else onList();
      }}
    />
  );
}

export function CreationLibraryPaneToggle({
  mode,
  expandedMode,
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
      expanded={expanded}
      label={label}
      data-action={expanded ? 'collapse-creation-library' : 'expand-creation-library'}
      disabled={!expanded && !canExpand}
      onClick={() => onModeChange(expanded ? 'images' : expandedMode)}
    />
  );
}

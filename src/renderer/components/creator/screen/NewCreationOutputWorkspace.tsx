import { useState, type ReactNode } from 'react';
import { FilesIcon } from 'lucide-react';
import { CreationOutputsPanel } from '@/renderer/components/creator/CreationOutputsPanel';
import { NewCreationDirections } from '@/renderer/components/creator/screen/NewCreationDirections';
import { isDocumentCreationStartMode } from '@/renderer/components/creator/creationStartMode';
import type { CreatorScreenViewModel } from '@/renderer/components/creator/screen/creatorScreenViewModel';
import { ContentWorkspace, ContentWorkspacePanels } from '@/renderer/features/content-editor/ContentWorkspacePanels';
import { useI18n } from '@/renderer/i18n/useI18n';

const preferenceKey = 'aiy.creation-outputs.expanded';

function initialOpen() {
  try {
    return window.localStorage.getItem(preferenceKey) !== 'false';
  } catch {
    return true;
  }
}

export function NewCreationOutputWorkspace({
  model,
  enabled,
  materialsImporting,
  children,
}: {
  model: CreatorScreenViewModel;
  enabled: boolean;
  materialsImporting: boolean;
  children: ReactNode;
}) {
  return (
    <ContentWorkspace dockedAt={768}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      {enabled && (
        <NewCreationOutputSidebar
          key={`${model.selection.inputSessionRevision}:${model.selection.creationStartMode}`}
          model={model}
          materialsImporting={materialsImporting}
        />
      )}
    </ContentWorkspace>
  );
}

function NewCreationOutputSidebar({
  model,
  materialsImporting,
}: {
  model: CreatorScreenViewModel;
  materialsImporting: boolean;
}) {
  const copy = useI18n().messages.creator.outputs;
  const inlineDirections = isDocumentCreationStartMode(model.selection.creationStartMode);
  const [open, setOpen] = useState(() => (inlineDirections ? false : initialOpen()));
  const changeOpen = (value: boolean) => {
    setOpen(value);
    if (inlineDirections) return;
    try {
      window.localStorage.setItem(preferenceKey, String(value));
    } catch {
      // The panel remains usable when layout preferences cannot be stored.
    }
  };
  return (
    <ContentWorkspacePanels
      preferenceKey="creation-outputs"
      minimumWidth={208}
      maximumWidth={360}
      open={open}
      onOpenChange={changeOpen}
      tabs={[
        {
          id: 'OUTPUTS',
          icon: FilesIcon,
          label: copy.title,
          content: (
            <CreationOutputsPanel
              createActions={
                inlineDirections ? undefined : (
                  <NewCreationDirections model={model} materialsImporting={materialsImporting} />
                )
              }
            />
          ),
        },
      ]}
    />
  );
}

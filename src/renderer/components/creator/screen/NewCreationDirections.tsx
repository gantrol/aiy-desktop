import { useEffect, useRef, useState } from 'react';
import { FileTextIcon, FilmIcon, ImageIcon, ListTreeIcon, VideoIcon } from 'lucide-react';
import type { CreationStartMode } from '@/shared/contracts/creation-draft';
import type { CreatorScreenViewModel } from '@/renderer/components/creator/screen/creatorScreenViewModel';
import { Button } from '@/renderer/components/ui/button';
import { useGifMakerLauncher } from '@/renderer/features/gif-making/GifMakerProvider';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { cn } from '@/renderer/lib/utils';

interface Props {
  model: CreatorScreenViewModel;
  materialsImporting: boolean;
  layout?: 'grid' | 'list';
}

export function NewCreationDirections({ model, materialsImporting, layout = 'list' }: Props) {
  const { app, generation, navigation, selection, workflow } = model;
  const labels = useI18n().messages.creator.outputs;
  const animation = useGifMakerLauncher();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const scope = useRef(generation.inputScopeKey);
  scope.current = generation.inputScopeKey;
  useEffect(() => {
    scope.current = generation.inputScopeKey;
    return () => {
      scope.current = '';
    };
  }, [generation.inputScopeKey]);
  const mode = selection.creationStartMode;
  const captureMaterials = useStableCallback(() => ({
    referenceAssetIds: generation.promptDocument.referenceAssets.map((asset) => asset.id),
    videoMaterialIds: generation.promptDocument.videoAttachments.map((video) => video.materialId),
  }));
  const tasks = [
    { id: 'manuscript', label: labels.article, icon: FileTextIcon },
    { id: 'outline', label: labels.outline, icon: ListTreeIcon },
    { id: 'image', label: labels.image, icon: ImageIcon },
    { id: 'animation', label: labels.animation, icon: FilmIcon },
    { id: 'video-document', label: labels.fromVideo, icon: VideoIcon },
  ] as const;

  async function choose(task: CreationStartMode | 'animation') {
    if (materialsImporting || pending.current || (task === mode && task !== 'manuscript' && task !== 'outline')) return;
    pending.current = true;
    setBusy(true);
    const capturedScope = scope.current;
    try {
      await generation.promptDocument.promptComposerRef.current?.whenSettled();
      if (scope.current !== capturedScope || !(await navigation.creation.preserveBeforeNavigation())) return;
      if (scope.current !== capturedScope) return;
      const materials = captureMaterials();
      const sourceDraftId = selection.creationDraftSession.getDraftId();
      const creationSource = sourceDraftId ? { kind: 'DRAFT' as const, id: sourceDraftId } : undefined;
      if (task === 'outline' || task === 'manuscript') {
        await workflow.content.outcome.start({ kind: task });
      } else if (task === 'animation') {
        await animation?.open({
          forceNew: true,
          targetAlbumId: selection.targetAlbumId,
          assetIds: materials.referenceAssetIds,
          creationSource,
        });
      } else {
        // Changing the task creates an independent draft. The saved body is never reused as a media prompt.
        await navigation.creation.startNewCreation(selection.targetAlbumId, 'push', true, task, {
          creationSource,
          ...(task === 'image'
            ? { referenceAssetIds: materials.referenceAssetIds }
            : { videoMaterialIds: materials.videoMaterialIds }),
        });
      }
    } catch (reason) {
      app.notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const disabled = materialsImporting || busy || workflow.starting;
  const unavailable = (task: (typeof tasks)[number]) =>
    disabled ||
    (task.id === 'animation' && !animation) ||
    (task.id === mode && task.id !== 'manuscript' && task.id !== 'outline');
  return (
    <div
      role="group"
      aria-label={labels.add}
      className={cn(
        layout === 'grid'
          ? 'grid grid-cols-1 gap-2 @[16rem]/creation-directions:grid-cols-2 @[24rem]/creation-directions:grid-cols-3 @[36rem]/creation-directions:grid-cols-5'
          : 'flex flex-col gap-0.5',
      )}
    >
      {tasks.map((task) => {
        return (
          <Button
            key={task.id}
            type="button"
            variant="ghost"
            aria-busy={busy}
            title={task.label}
            disabled={unavailable(task)}
            className={cn(
              'h-auto min-w-0 whitespace-normal rounded-sm px-2 shadow-none',
              layout === 'grid'
                ? 'min-h-24 flex-col justify-center gap-3 py-4 text-center'
                : 'min-h-9 justify-start gap-2 py-2 text-left',
            )}
            onClick={() => void choose(task.id)}
          >
            <task.icon
              className={cn('shrink-0 text-muted-foreground', layout === 'grid' ? 'size-5' : 'size-4')}
              aria-hidden="true"
            />
            <span className="min-w-0 break-words">{task.label}</span>
          </Button>
        );
      })}
    </div>
  );
}

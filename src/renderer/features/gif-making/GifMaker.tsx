import { useEffect, useRef, useState } from 'react';
import { useGifMaker, type GifMakerProps, type GifMakerModel } from '@/renderer/features/gif-making/useGifMaker';
import { GifMakerHeader } from '@/renderer/features/gif-making/GifMakerHeader';
import { GifMakerPickers } from '@/renderer/features/gif-making/GifMakerPickers';
import { useGifGeneration, type GifGenerationModel } from '@/renderer/features/gif-making/useGifGeneration';
import { GifEditorWorkspace } from '@/renderer/features/gif-making/GifEditorWorkspace';
import { GifMotionWorkspace } from '@/renderer/features/gif-making/GifMotionWorkspace';
import { GifResultWorkspace } from '@/renderer/features/gif-making/GifResultWorkspace';
import type { GifGenerationCandidate } from '@/shared/contracts/gif-generation';
import { gifErrorCode, type GifDocumentDetail } from '@/shared/contracts/gif-making';
import type { AnimationLocation, GifLaunchInput } from '@/renderer/features/gif-making/GifMakerProvider';
import type { NavigationMode, CreatorOpenTabTarget } from '@/renderer/components/app/app-navigation';
import type { BootstrapDto } from '@/shared/contracts';
import { CreationWorksMenu } from '@/renderer/components/creator/CreationWorksMenu';
import { creationFormTabTarget } from '@/renderer/components/creator/creationFormTabTarget';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { GifAdoptionAction } from '@/renderer/features/gif-making/GifAdoptionAction';
import { useGifWorkspaceCopy } from '@/renderer/features/gif-making/useGifWorkspaceCopy';
import { GifWorkflowNav } from '@/renderer/features/gif-making/GifWorkflowNav';

function useGifCandidateRestore(candidateId: string | undefined, motion: GifGenerationModel) {
  const restored = useRef<string | null>(null);
  const select = useStableCallback(motion.selectCandidate);
  const history = motion.history;
  useEffect(() => {
    if (!candidateId) {
      restored.current = null;
      return;
    }
    if (restored.current === candidateId || !history.some((candidate) => candidate.id === candidateId)) return;
    restored.current = candidateId;
    select(candidateId);
    // Later history arrivals must not replace a newly generated or explicitly chosen result.
  }, [candidateId, history, select]);
}

function workspaceHeaderModel(
  editor: GifMakerModel,
  draft: GifMakerModel,
  save: GifMakerModel['project']['save'],
  copying: boolean,
  adopting: boolean,
): GifMakerModel {
  return {
    ...editor,
    busy: editor.busy || draft.busy || copying || adopting,
    project: {
      ...editor.project,
      conflicted: editor.project.conflicted || draft.project.conflicted,
      dirty: editor.project.dirty || draft.project.dirty,
      saving: editor.project.saving || draft.project.saving,
      save,
    },
  };
}

function motionWorkspaceModel(editor: GifMakerModel, draft: GifMakerModel, locked: boolean): GifMakerModel {
  return {
    ...draft,
    busy: draft.busy || editor.busy || locked || editor.exporting,
    project: { ...draft.project, error: draft.project.error ?? editor.project.error },
  };
}

export default function GifMaker(
  props: GifMakerProps & {
    data?: BootstrapDto;
    notify(message: string): void;
    onOpenWork(target: CreatorOpenTabTarget): void;
    initialDocument: GifDocumentDetail;
    motionDocument: GifDocumentDetail;
    visible: boolean;
    route?: AnimationLocation;
    onNavigate(location: AnimationLocation, mode?: NavigationMode): void;
    onOpen(input: GifLaunchInput): Promise<void>;
    onRefresh(): Promise<boolean>;
    onOpenGroup(postId: string): void;
  },
) {
  const [page, setLocalPage] = useState<AnimationLocation['step']>(
    props.route?.step ?? (props.initialDocument.document.manifest.frames.length ? 'edit' : 'generate'),
  );
  const draft = useGifMaker({
    ...props,
    purpose: 'MOTION',
    initialDocument: props.motionDocument,
    initialAssets: props.motionDocument.assets,
  });
  const editor = useGifMaker({ ...props, purpose: 'GIF' });
  const { labels } = editor;
  const { copying, saveCopy } = useGifWorkspaceCopy({
    editor: editor.project,
    motion: draft.project,
    refresh: props.onRefresh,
    onOpen: props.onOpen,
  });
  const setPage = useStableCallback(
    (step: AnimationLocation['step'], candidateId: string | undefined = props.route?.candidateId) => {
      setLocalPage(step);
      editor.setPlaying(false);
      props.onNavigate(
        {
          surface: 'animation',
          documentId: editor.document.id,
          seriesId: editor.document.seriesId,
          title: editor.document.title || labels.untitled,
          step,
          ...(props.route?.frameId ? { frameId: props.route.frameId } : {}),
          ...(candidateId ? { candidateId } : {}),
          ...(props.route?.adoptionTarget ? { adoptionTarget: props.route.adoptionTarget } : {}),
        },
        'replace',
      );
    },
  );
  const requestedStep = props.route?.step;
  useEffect(() => {
    if (requestedStep) setLocalPage(requestedStep);
  }, [requestedStep]);
  const saveSession = useStableCallback(async () => {
    await draft.project.save();
    return editor.project.save();
  });
  const adopt = async (candidate: GifGenerationCandidate, copy: boolean) => {
    if (editor.busy || editor.exporting) throw new Error('GIF_BUSY');
    if (copy) {
      if (!candidate.manifest) return;
      await saveCopy({ ...candidate.manifest, generationId: candidate.id });
      return;
    }
    // Reopening the same adopted group preserves subsequent timing/crop edits.
    if (editor.manifest.generationId !== candidate.id) {
      const expected = editor.project.capture();
      const saved = await editor.project.save();
      const detail = await window.desktopApi.gifGenerationAdopt({
        id: candidate.id,
        documentId: saved.id,
        expectedRevision: saved.revision,
      });
      editor.project.accept(detail, expected);
      if (!detail.document.title && candidate.settings.plan?.title) editor.project.title(candidate.settings.plan.title);
      editor.setResult(null);
      editor.setShowEncoded(false);
      editor.setPlaying(false);
    }
    setPage('edit');
  };
  const navigateSelection = useStableCallback((patch: Partial<Pick<AnimationLocation, 'frameId' | 'candidateId'>>) => {
    if (props.route) props.onNavigate({ ...props.route, ...patch }, 'replace');
  });
  const onGenerated = useStableCallback((candidate: GifGenerationCandidate) => {
    if (page === 'generate') setPage('review', candidate.id);
    else navigateSelection({ candidateId: candidate.id });
  });
  const motion = useGifGeneration(
    draft,
    (candidate, copy) => adopt(candidate, copy).catch((reason) => editor.project.setError(gifErrorCode(reason))),
    onGenerated,
  );
  const [savingGroup, setSavingGroup] = useState(false);
  const saveGroup = async () => {
    if (!motion.candidate || savingGroup) return;
    setSavingGroup(true);
    try {
      await saveSession();
      const postId = await window.desktopApi.gifFramesAsGroup(editor.document.id, motion.candidate.id);
      if (await props.onRefresh()) props.onOpenGroup(postId);
    } finally {
      setSavingGroup(false);
    }
  };
  const { setPlaying } = editor;
  useEffect(() => {
    if (!props.visible) setPlaying(false);
  }, [props.visible, setPlaying]);
  const close = async () => {
    try {
      await saveSession();
      await props.onRefresh();
      props.onClose();
    } catch {
      /* Keep the save error and draft visible. */
    }
  };
  const open = async (input: GifLaunchInput) => {
    await saveSession();
    await props.onRefresh();
    await props.onOpen(input);
  };
  const selectedFrame = props.route?.frameId;
  useEffect(() => {
    if (selectedFrame && editor.manifest.frames.some((frame) => frame.id === selectedFrame))
      editor.select(selectedFrame);
    // Restore navigation state, not an autosave revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFrame]);
  useGifCandidateRestore(props.route?.candidateId, motion);
  if (!props.visible) return null;
  const workspaceLocked = copying || motion.adopting;
  const generationModel = motionWorkspaceModel(editor, draft, workspaceLocked);
  const activeModel =
    page === 'edit'
      ? { ...editor, busy: editor.busy || workspaceLocked }
      : { ...generationModel, busy: generationModel.busy || motion.running };
  return (
    <section
      className="@container/gif-maker mx-auto flex h-full w-full max-w-6xl min-w-0 flex-col bg-background"
      aria-label={labels.workspaceTitle}
      data-workspace="gif-maker"
      data-gif-document-id={editor.document.id}
    >
      <GifMakerHeader
        model={workspaceHeaderModel(editor, draft, saveSession, copying, motion.adopting)}
        workNavigation={
          props.data && (
            <CreationWorksMenu
              key={editor.document.id}
              data={props.data}
              activeEntity={{ kind: 'GIF_DOCUMENT', id: editor.document.id }}
              notify={props.notify}
              onSelect={async (form) => {
                const item = props.data?.creationItems.find((item) => item.id === form.form.creationItemId);
                const target = creationFormTabTarget(form, item?.albumId ?? null);
                if (!target) return;
                await saveSession();
                await props.onRefresh();
                props.onOpenWork(target);
              }}
            />
          )
        }
        onOpen={open}
        onCopy={() => saveCopy()}
        onClose={close}
        onTitleChange={(title) => {
          editor.project.title(title);
          if (props.route) props.onNavigate({ ...props.route, title }, 'replace');
        }}
      />
      <GifWorkflowNav
        step={page}
        running={motion.running}
        disabled={workspaceLocked || savingGroup}
        onChange={setPage}
      />
      {page === 'generate' ? (
        <GifMotionWorkspace
          model={generationModel}
          motion={motion}
          onSkip={() => setPage('edit')}
          hasEditor={editor.manifest.frames.length > 0}
        />
      ) : page === 'review' ? (
        <GifResultWorkspace
          model={generationModel}
          motion={{
            ...motion,
            selectCandidate: (id) => {
              motion.selectCandidate(id);
              navigateSelection({ candidateId: id });
            },
          }}
          candidate={motion.candidate}
          onSetup={() => setPage('generate')}
          hasEditor={editor.manifest.frames.length > 0}
          alreadyAdopted={editor.manifest.generationId === motion.candidate?.id}
          onSaveGroup={() => draft.safe(saveGroup)}
          savingGroup={savingGroup}
        />
      ) : (
        <GifEditorWorkspace
          model={{
            ...editor,
            busy: editor.busy || workspaceLocked,
            project: { ...editor.project, error: editor.project.error ?? draft.project.error },
            select: (id) => {
              editor.select(id);
              navigateSelection({ frameId: id });
            },
          }}
          adoption={
            props.route?.adoptionTarget &&
            editor.result &&
            !editor.project.dirty &&
            editor.result.revision === editor.document.revision ? (
              <GifAdoptionAction
                key={JSON.stringify([
                  props.spaceId,
                  editor.result.asset.id,
                  props.route.adoptionTarget.visualId,
                  props.route.adoptionTarget.expectedRevisionId,
                  props.route.adoptionTarget.intent,
                ])}
                assetId={editor.result.asset.id}
                target={props.route.adoptionTarget}
                spaceId={props.spaceId}
                refresh={async () => {
                  await props.onRefresh();
                }}
              />
            ) : null
          }
        />
      )}
      <GifMakerPickers model={activeModel} />
    </section>
  );
}

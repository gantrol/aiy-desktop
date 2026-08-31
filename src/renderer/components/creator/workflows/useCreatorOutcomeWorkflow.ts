import { useEffect, useRef, useState } from 'react';
import type {
  ArticleContentInput,
  AssetDto,
  CreationDraftDto,
  CreationDraftSaveInput,
  Locale,
  SocialPostContentInput,
} from '@/shared/contracts';
import type { ResolvedPromptComposition } from '@/shared/prompt-composition';
import {
  articleMediaBindings,
  markdownWithImages,
} from '@/renderer/components/creator/article-editor/articleContentTransforms';
import type { CreationOutcomePlan } from '@/renderer/components/creator/CreationOutcomePicker';
import type { CreationDraftPromptSnapshot } from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import { creationDraftCommitIdentity } from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

type DraftSaveSnapshot = Omit<CreationDraftSaveInput, 'id'>;

interface OutcomeSnapshot {
  automaticChangeSummary: string;
  livePrompt: string;
  locale: Locale;
  prompt: CreationDraftPromptSnapshot;
  referenceAssets: AssetDto[];
  resolvedPrompt: ResolvedPromptComposition;
  savedDraftTitle: string;
  sourceInspirationStashId: string | null;
  targetAlbumId: string | null;
  termPromptLocale: Locale;
  typedTitle: string;
}

interface DraftContentInput<T> {
  content: T;
  creationDraftCommitIdentity: string;
  creationDraftId: string;
  sourceInspirationStashId: string | null;
  targetAlbumId: string | null;
}

interface Options {
  captureDraftSaveSnapshot(prompt: CreationDraftPromptSnapshot): DraftSaveSnapshot;
  captureSnapshot(): OutcomeSnapshot;
  createArticleFromDraft(input: DraftContentInput<ArticleContentInput>): Promise<void>;
  createSocialPostFromDraft(input: DraftContentInput<SocialPostContentInput>): Promise<void>;
  invalidateAutosaves(): void;
  notify(message: string): void;
  onImageCommitted(result: { seriesId: string; versionId: string }): void;
  onPromptCaptured(prompt: CreationDraftPromptSnapshot): void;
  refresh(): Promise<void>;
  requestIdentity: string;
  saveCapturedDraft(snapshot: DraftSaveSnapshot): Promise<CreationDraftDto>;
  saveDraft(prompt: CreationDraftPromptSnapshot): Promise<CreationDraftDto>;
}

function messageFor(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function outcomeTitle(snapshot: OutcomeSnapshot, fallback: string) {
  const firstLine = snapshot.prompt.manualPrompt
    .split(/\r?\n/u)
    .map((line) => line.replace(/^#+\s*/u, '').trim())
    .find(Boolean);
  return (
    snapshot.typedTitle ||
    Array.from(firstLine ?? '')
      .slice(0, 60)
      .join('') ||
    fallback
  );
}

export function useCreatorOutcomeWorkflow(options: Options) {
  const [starting, setStarting] = useState(false);
  const busyRef = useRef(false);
  const revisionRef = useRef(0);
  const captureDraftSaveSnapshot = useStableCallback(options.captureDraftSaveSnapshot);
  const captureSnapshot = useStableCallback(options.captureSnapshot);
  const createArticleFromDraft = useStableCallback(options.createArticleFromDraft);
  const createSocialPostFromDraft = useStableCallback(options.createSocialPostFromDraft);
  const getRequestIdentity = useStableCallback(() => options.requestIdentity);
  const invalidateAutosaves = useStableCallback(options.invalidateAutosaves);
  const notify = useStableCallback(options.notify);
  const onImageCommitted = useStableCallback(options.onImageCommitted);
  const onPromptCaptured = useStableCallback(options.onPromptCaptured);
  const refresh = useStableCallback(options.refresh);
  const saveCapturedDraft = useStableCallback(options.saveCapturedDraft);
  const saveDraft = useStableCallback(options.saveDraft);

  useEffect(() => {
    revisionRef.current += 1;
    busyRef.current = false;
    setStarting(false);
  }, [options.requestIdentity]);

  const start = useStableCallback(async (plan: CreationOutcomePlan) => {
    if (busyRef.current) return;
    let snapshot: OutcomeSnapshot;
    try {
      snapshot = captureSnapshot();
    } catch (reason) {
      notify(messageFor(reason));
      return;
    }
    if (plan.kind === 'image' && !snapshot.livePrompt.trim()) return;
    if (plan.kind === 'social-post' && !snapshot.prompt.manualPrompt.trim()) return;
    if (plan.kind === 'article' && !snapshot.prompt.manualPrompt.trim() && !snapshot.referenceAssets.length) return;
    const requestIdentity = getRequestIdentity();
    const revision = ++revisionRef.current;
    const requestIsCurrent = () => revisionRef.current === revision && getRequestIdentity() === requestIdentity;
    busyRef.current = true;
    setStarting(true);
    onPromptCaptured(snapshot.prompt);
    invalidateAutosaves();
    try {
      if (plan.kind === 'image') {
        const draft = await saveDraft(snapshot.prompt);
        if (!requestIsCurrent()) return;
        const title = snapshot.typedTitle || snapshot.savedDraftTitle || '新创作';
        const result = await window.desktopApi.creationDraftCommit({
          creationDraftId: draft.id,
          inspirationStashId: snapshot.sourceInspirationStashId,
          title,
          manualPrompt: snapshot.prompt.manualPrompt,
          promptNodes: snapshot.prompt.nodes,
          prompt: snapshot.livePrompt,
          resolvedPrompt: snapshot.resolvedPrompt,
          changeSummary: snapshot.automaticChangeSummary,
          referenceAssetIds: snapshot.referenceAssets.map((asset) => asset.id),
          termPromptLocale: snapshot.termPromptLocale,
          termIds: snapshot.prompt.selectedTerms.map((term) => term.id),
          wordPaletteReferences: snapshot.prompt.appliedPalettes.map((reference) => ({
            paletteId: reference.palette.id,
            paletteRevisionId: reference.revision.id,
            parameterValues: { ...reference.parameterValues },
            promptLocale: reference.promptLocale,
          })),
        });
        await refresh();
        if (!requestIsCurrent()) return;
        onImageCommitted(result);
        notify(snapshot.locale === 'zh' ? '已开启创作' : 'Creation started');
        return;
      }
      const draftSnapshot = captureDraftSaveSnapshot(snapshot.prompt);
      const draft = await saveCapturedDraft(draftSnapshot);
      const common = {
        creationDraftId: draft.id,
        creationDraftCommitIdentity: creationDraftCommitIdentity(draft.id, draftSnapshot),
        sourceInspirationStashId: snapshot.sourceInspirationStashId,
        targetAlbumId: snapshot.targetAlbumId,
      };
      if (plan.kind === 'social-post') {
        await createSocialPostFromDraft({
          ...common,
          content: {
            schemaVersion: 1,
            title: outcomeTitle(snapshot, '新贴图'),
            body: snapshot.prompt.manualPrompt,
            mediaAssetIds: snapshot.referenceAssets.map((asset) => asset.id),
            coverAssetId: snapshot.referenceAssets[0]?.id ?? null,
          },
        });
      } else {
        const mediaBindings = articleMediaBindings(snapshot.referenceAssets, 'reference');
        await createArticleFromDraft({
          ...common,
          content: {
            schemaVersion: 1,
            title: outcomeTitle(snapshot, '新文章'),
            markdown: markdownWithImages(snapshot.prompt.manualPrompt.trim(), mediaBindings, snapshot.locale),
            mediaBindings,
            coverAssetId: snapshot.referenceAssets[0]?.id ?? null,
          },
        });
      }
    } catch (reason) {
      if (requestIsCurrent()) notify(messageFor(reason));
    } finally {
      if (revisionRef.current === revision) {
        busyRef.current = false;
        setStarting(false);
      }
    }
  });

  return { start, starting };
}

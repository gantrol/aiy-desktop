import { articleMediaBindings } from '@/renderer/components/creator/article-editor/articleContentTransforms';
import type { CreationStartPlan } from '@/renderer/components/creator/CreationStartActions';
import type { CreationDraftPromptSnapshot } from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import { creationDraftCommitIdentity } from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { blockDocumentMarkdown, blockDocumentText, plainTextBlockDocument } from '@/shared/block-document-codecs';
import type { ArticleContentInput, AssetDto, CreationDraftDto, CreationDraftSaveInput } from '@/shared/contracts';
import { blockDocumentAssetIds, captureBlockDocument } from '@/shared/contracts/block-document';
import { useEffect, useRef, useState } from 'react';
import { useGifMakerLauncher } from '@/renderer/features/gif-making/GifMakerProvider';

type DraftSaveSnapshot = Omit<CreationDraftSaveInput, 'id' | 'expectedUpdatedAt'>;

interface OutcomeSnapshot {
  prompt: CreationDraftPromptSnapshot;
  referenceAssets: AssetDto[];
  savedDraftTitle: string;
  sourceInspirationStashId: string | null;
  targetAlbumId: string | null;
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
  invalidateAutosaves(): void;
  notify(message: string): void;
  onPromptCaptured(prompt: CreationDraftPromptSnapshot): void;
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

function hasOutcomeContent(snapshot: OutcomeSnapshot) {
  return snapshot.prompt.document
    ? Boolean(
        blockDocumentText(snapshot.prompt.document).trim() || blockDocumentAssetIds(snapshot.prompt.document).length,
      )
    : Boolean(snapshot.prompt.manualPrompt.trim());
}

export function useCreatorOutcomeWorkflow(options: Options) {
  const animation = useGifMakerLauncher();
  const messages = useI18n().messages;
  const [starting, setStarting] = useState(false);
  const busyRef = useRef(false);
  const revisionRef = useRef(0);
  const captureDraftSaveSnapshot = useStableCallback(options.captureDraftSaveSnapshot);
  const captureSnapshot = useStableCallback(options.captureSnapshot);
  const createArticleFromDraft = useStableCallback(options.createArticleFromDraft);
  const getRequestIdentity = useStableCallback(() => options.requestIdentity);
  const invalidateAutosaves = useStableCallback(options.invalidateAutosaves);
  const notify = useStableCallback(options.notify);
  const onPromptCaptured = useStableCallback(options.onPromptCaptured);
  const saveCapturedDraft = useStableCallback(options.saveCapturedDraft);
  const saveDraft = useStableCallback(options.saveDraft);

  useEffect(() => {
    revisionRef.current += 1;
    busyRef.current = false;
    setStarting(false);
  }, [options.requestIdentity]);

  const start = useStableCallback(async (plan: CreationStartPlan) => {
    if (busyRef.current) return;
    let snapshot: OutcomeSnapshot;
    try {
      snapshot = captureSnapshot();
    } catch (reason) {
      notify(messageFor(reason));
      return;
    }
    const hasContent = hasOutcomeContent(snapshot);
    if (plan.kind === 'manuscript' && !hasContent && !snapshot.referenceAssets.length) return;
    const requestIdentity = getRequestIdentity();
    const revision = ++revisionRef.current;
    const requestIsCurrent = () => revisionRef.current === revision && getRequestIdentity() === requestIdentity;
    busyRef.current = true;
    setStarting(true);
    onPromptCaptured(snapshot.prompt);
    invalidateAutosaves();
    try {
      if (plan.kind === 'animation') {
        if (hasContent || snapshot.referenceAssets.length) await saveDraft(snapshot.prompt);
        if (!requestIsCurrent()) return;
        await animation?.open({
          forceNew: true,
          title: snapshot.typedTitle || snapshot.savedDraftTitle,
          initialPrompt: snapshot.prompt.manualPrompt,
          assetIds: snapshot.referenceAssets.map((asset) => asset.id),
          targetAlbumId: snapshot.targetAlbumId,
        });
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
      const sourceDocument = snapshot.prompt.document ?? plainTextBlockDocument(snapshot.prompt.manualPrompt);
      const document = captureBlockDocument(sourceDocument.root, [], true);
      const mediaBindings = articleMediaBindings(snapshot.referenceAssets, 'reference');
      const inlineIds = new Set(blockDocumentAssetIds(document));
      const articleDocument = captureBlockDocument({
        ...document.root,
        content: [
          ...(document.root.content ?? []),
          ...mediaBindings
            .filter((binding) => !inlineIds.has(binding.assetId))
            .map((binding) => ({ type: 'image', attrs: { assetId: binding.assetId, alt: '' } })),
        ],
      });
      await createArticleFromDraft({
        ...common,
        content: {
          schemaVersion: 2,
          document: articleDocument,
          title: outcomeTitle(snapshot, messages.contentEditor.untitledArticle),
          markdown: blockDocumentMarkdown(articleDocument, mediaBindings),
          mediaBindings,
          coverAssetId: snapshot.referenceAssets[0]?.id ?? null,
        },
      });
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

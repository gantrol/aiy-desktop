import type { CompanionSite, FillDraftErrorCode, FillDraftResponse } from '@/lib/protocol';
import type { ComposerMediaSnapshot } from '@/lib/composer-adapters/contract';
import { composerAdapter } from '@/lib/composer-adapters/registry';
import {
  clearComposer,
  focusComposer,
  normalizeDraft,
  readComposerText,
  setMediaFiles,
  setTextControlValue,
} from '@/lib/composer-adapters/dom';

interface FillComposerOptions {
  replaceExisting?: boolean;
  title?: string;
  contentKind?: string;
  articleHtml?: string;
  articleCoverMediaIndex?: number;
}

export function composerReady(site: CompanionSite, contentKind?: string): boolean {
  return composerAdapter(site, contentKind).findEditors().length === 1;
}

export async function openComposer(site: CompanionSite, handoffId: string, contentKind?: string): Promise<boolean> {
  return composerAdapter(site, contentKind).openComposer?.(handoffId) ?? false;
}

export function captureComposerMediaSnapshot(site: CompanionSite, contentKind?: string): ComposerMediaSnapshot | null {
  return composerAdapter(site, contentKind).captureMedia?.() ?? null;
}

export async function confirmComposerMedia(
  site: CompanionSite,
  files: readonly File[],
  snapshot: ComposerMediaSnapshot | null,
  timeoutMs: number,
  contentKind?: string,
): Promise<boolean> {
  return composerAdapter(site, contentKind).confirmMedia?.(files, snapshot, timeoutMs) ?? true;
}

function failure(requestId: string, site: CompanionSite, code: FillDraftErrorCode): FillDraftResponse {
  return { ok: false, requestId, site, code };
}

export async function fillComposer(
  site: CompanionSite,
  requestId: string,
  draft: string,
  mediaFiles: readonly File[] = [],
  options: FillComposerOptions = {},
): Promise<FillDraftResponse> {
  const adapter = composerAdapter(site, options.contentKind);
  if (options.contentKind === 'article-body' && (!options.articleHtml || !options.title || !adapter.fillArticle))
    return failure(requestId, site, 'INVALID_REQUEST');
  const drafts = adapter.splitDraft ? adapter.splitDraft(draft) : [draft];
  if (!drafts?.length || (drafts.length > 1 && !adapter.appendDraft)) return failure(requestId, site, 'FILL_FAILED');
  const firstDraft = drafts[0]!;
  const draftError = adapter.validateDraft?.(draft, options.title);
  if (draftError) return failure(requestId, site, draftError);
  if (adapter.acceptsMedia && !adapter.acceptsMedia(mediaFiles)) {
    return failure(requestId, site, 'MEDIA_UNSUPPORTED');
  }
  const readText = adapter.readText ?? readComposerText;
  const prepared = mediaFiles.length > 0 ? await adapter.prepareMedia?.(mediaFiles, options) : undefined;
  if (prepared && !prepared.ok) return failure(requestId, site, prepared.code);
  const candidates = prepared ? [prepared.editor] : adapter.findEditors();
  if (candidates.length === 0) return failure(requestId, site, 'COMPOSER_NOT_FOUND');
  if (candidates.length !== 1) return failure(requestId, site, 'COMPOSER_AMBIGUOUS');

  const editor = candidates[0];
  if (!editor) return failure(requestId, site, 'COMPOSER_NOT_FOUND');
  if (!prepared && adapter.hasExistingMedia?.(editor)) return failure(requestId, site, 'COMPOSER_HAS_MEDIA');
  const title = options.title?.trim();
  const titleControl = title ? (adapter.findTitle?.(editor) ?? null) : null;
  if (title && adapter.findTitle && !titleControl) return failure(requestId, site, 'COMPOSER_NOT_FOUND');
  if (
    (normalizeDraft(readText(editor)).length > 0 ||
      (titleControl && normalizeDraft(readText(titleControl)).length > 0)) &&
    !options.replaceExisting
  ) {
    return failure(requestId, site, 'COMPOSER_NOT_EMPTY');
  }
  if (options.articleHtml && adapter.fillArticle) {
    if (mediaFiles.length && !adapter.findMediaInput(editor)) return failure(requestId, site, 'MEDIA_INPUT_NOT_FOUND');
    if (titleControl && title) {
      if (options.replaceExisting && !clearComposer(titleControl)) return failure(requestId, site, 'FILL_FAILED');
      setTextControlValue(titleControl, title);
      if (normalizeDraft(readText(titleControl)) !== normalizeDraft(title))
        return failure(requestId, site, 'FILL_FAILED');
    }
    const code = await adapter.fillArticle(editor, options.articleHtml, mediaFiles, options.articleCoverMediaIndex);
    if (code) return failure(requestId, site, code);
    if (titleControl && title && normalizeDraft(readText(titleControl)) !== normalizeDraft(title))
      return failure(requestId, site, 'FILL_FAILED');
    return { ok: true, requestId, site, characterCount: [...draft].length };
  }
  let mediaInput = mediaFiles.length > 0 && !prepared ? adapter.findMediaInput(editor) : null;
  if (mediaFiles.length > 0 && !prepared && !mediaInput) {
    adapter.requestMediaInput(editor);
    mediaInput = adapter.findMediaInput(editor);
  }
  if (mediaFiles.length > 0 && !prepared && !mediaInput) {
    focusComposer(editor);
    return failure(requestId, site, 'MEDIA_INPUT_NOT_FOUND');
  }

  if (
    options.replaceExisting &&
    ((!adapter.writeText && normalizeDraft(readText(editor)).length > 0 && !clearComposer(editor)) ||
      (!adapter.writeTitle &&
        titleControl &&
        normalizeDraft(readText(titleControl)).length > 0 &&
        !clearComposer(titleControl)))
  ) {
    return failure(requestId, site, 'FILL_FAILED');
  }

  if (titleControl && title) {
    if (adapter.writeTitle) {
      if (!(await adapter.writeTitle(titleControl, title, Boolean(options.replaceExisting))))
        return failure(requestId, site, 'FILL_FAILED');
    } else setTextControlValue(titleControl, title);
  }
  const mediaSnapshot = drafts.length > 1 ? (adapter.captureMedia?.() ?? null) : null;
  if (adapter.writeText) {
    if (!(await adapter.writeText(editor, firstDraft, Boolean(options.replaceExisting)))) {
      return failure(requestId, site, 'FILL_FAILED');
    }
  } else setTextControlValue(editor, firstDraft);

  if (
    normalizeDraft(readText(editor)) !== normalizeDraft(firstDraft) ||
    (titleControl && title && normalizeDraft(readText(titleControl)) !== normalizeDraft(title))
  ) {
    return failure(requestId, site, 'FILL_FAILED');
  }

  if (mediaInput && !setMediaFiles(mediaInput, mediaFiles)) {
    return failure(requestId, site, 'MEDIA_FILL_FAILED');
  }

  if (drafts.length > 1) {
    // X moves the upload toolbar to the active post when a thread grows.
    // Finish the first post's uploads before adding another editor.
    if (mediaFiles.length && !(await adapter.confirmMedia?.(mediaFiles, mediaSnapshot, 90_000)))
      return failure(requestId, site, 'MEDIA_FILL_FAILED');
    if (!(await adapter.appendDraft!(editor, drafts.slice(1)))) return failure(requestId, site, 'FILL_FAILED');
  }

  return {
    ok: true,
    requestId,
    site,
    characterCount: [...draft].length,
  };
}

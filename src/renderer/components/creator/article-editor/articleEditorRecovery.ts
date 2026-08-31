import type {
  ArticleCommentAnchorUpdateInput,
  ArticleContentInput,
  ArticleDto,
  ArticleElementPlacementInput,
  ArticleRevisionSaveInput,
  VideoDocumentRevisionMediaDto,
} from '@/shared/contracts';
import {
  articleCommentAnchorUpdatesAreApplied,
  articleCommentAnchorUpdates,
  articleContentSchema,
  canonicalArticleContentJson,
  sameArticleCommentAnchorUpdates,
  sameArticleElementPlacements,
} from '@/shared/contracts/article';
import {
  articleEditorRecoveryCheckpointSchema,
  type ArticleEditorRecoveryCheckpoint,
} from '@/shared/contracts/article-editor-recovery';
import { editableArticleContent } from '@/renderer/components/creator/article-editor/articleEditorSnapshot';

const storagePrefix = 'aiy.article-editor-recovery.v1';
const maxStoredCheckpointCharacters = 4_000_000;
type RecoveryCheckpoint = ArticleEditorRecoveryCheckpoint;

export interface ArticleEditorRecoveredDraft {
  content: ArticleContentInput;
  media: readonly VideoDocumentRevisionMediaDto[];
  elements: readonly ArticleElementPlacementInput[];
  commentAnchors: readonly ArticleCommentAnchorUpdateInput[];
}

export type ArticleEditorRecoveryResult =
  | { kind: 'none' }
  | { kind: 'restored'; draft: ArticleEditorRecoveredDraft; updatedAt: number }
  | { kind: 'conflict'; draft: ArticleEditorRecoveredDraft; updatedAt: number };

interface RecordDraftInput extends ArticleEditorRecoveredDraft {
  draftSeq: number;
  baseRevisionId: string;
  baseContentHash: string;
}

function checkpointPrefix(spaceId: string, articleId: string) {
  return `${storagePrefix}:${encodeURIComponent(spaceId)}:${encodeURIComponent(articleId)}:`;
}

function checkpointKey(prefix: string, sessionEpoch: string) {
  return `${prefix}${encodeURIComponent(sessionEpoch)}`;
}

function storageKeys(storage: Storage, prefix: string) {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

function parseCheckpoint(serialized: string | null) {
  if (!serialized || serialized.length > maxStoredCheckpointCharacters) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    const parsed = articleEditorRecoveryCheckpointSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function sameContent(left: ArticleContentInput, right: ArticleContentInput) {
  return canonicalArticleContentJson(left) === canonicalArticleContentJson(right);
}

function copyDraft(checkpoint: RecoveryCheckpoint): ArticleEditorRecoveredDraft {
  return {
    content: articleContentSchema.parse(checkpoint.content),
    media: checkpoint.media.map((item) => ({ ...item })),
    elements: checkpoint.elements.map((item) => ({ ...item })),
    commentAnchors: (checkpoint.commentAnchors ?? []).map((item) => ({ ...item, anchor: { ...item.anchor } })),
  };
}

function sameCheckpointAsArticle(
  checkpoint: RecoveryCheckpoint,
  article: ArticleDto,
  currentContent: ArticleContentInput,
) {
  if (!sameContent(checkpoint.content, currentContent)) return false;
  if (!sameArticleElementPlacements(checkpoint.elements, article.elements)) return false;
  return (
    !checkpoint.commentAnchors ||
    articleCommentAnchorUpdatesAreApplied(checkpoint.commentAnchors, articleCommentAnchorUpdates(article.comments))
  );
}

function sameCheckpointAsRequest(checkpoint: RecoveryCheckpoint, input: ArticleRevisionSaveInput) {
  if (!sameContent(checkpoint.content, input.content)) return false;
  if (input.elements && !sameArticleElementPlacements(checkpoint.elements, input.elements)) return false;
  return (
    !input.commentAnchors || sameArticleCommentAnchorUpdates(checkpoint.commentAnchors ?? [], input.commentAnchors)
  );
}

function recoverableFromCurrent(checkpoint: RecoveryCheckpoint, article: ArticleDto) {
  if (checkpoint.baseRevisionId === article.revisionId && checkpoint.baseContentHash === article.contentHash) {
    return true;
  }
  return (
    checkpoint.pendingSave?.expectedRevisionId === checkpoint.baseRevisionId &&
    checkpoint.pendingSave.contentHash === article.contentHash
  );
}

export class ArticleEditorRecoveryStore {
  readonly result: ArticleEditorRecoveryResult;
  readonly #storage: Storage | null;
  readonly #key: string;
  readonly #spaceId: string;
  readonly #articleId: string;
  readonly #sessionEpoch: string;
  #checkpoint: RecoveryCheckpoint | null = null;
  #sourceCheckpoint: { sessionEpoch: string; localKey: string | null } | null = null;

  constructor(spaceId: string, article: ArticleDto, sessionEpoch: string) {
    this.#spaceId = spaceId;
    this.#articleId = article.id;
    this.#sessionEpoch = sessionEpoch;
    const prefix = checkpointPrefix(spaceId, article.id);
    this.#key = checkpointKey(prefix, sessionEpoch);
    try {
      this.#storage = window.localStorage;
    } catch {
      this.#storage = null;
    }
    const currentContent = editableArticleContent(article);
    const checkpoints = new Map<string, { key: string | null; checkpoint: RecoveryCheckpoint }>();
    const acceptCandidate = (key: string | null, checkpoint: RecoveryCheckpoint) => {
      const existing = checkpoints.get(checkpoint.sessionEpoch);
      if (!existing || checkpoint.updatedAt >= existing.checkpoint.updatedAt) {
        checkpoints.set(checkpoint.sessionEpoch, {
          key: key ?? existing?.key ?? null,
          checkpoint,
        });
      }
    };
    const storage = this.#storage;
    if (storage) {
      try {
        for (const key of storageKeys(storage, prefix)) {
          const checkpoint = parseCheckpoint(storage.getItem(key));
          if (!checkpoint || checkpoint.spaceId !== spaceId || checkpoint.articleId !== article.id) {
            storage.removeItem(key);
            continue;
          }
          acceptCandidate(key, checkpoint);
        }
      } catch {
        // Durable main-process checkpoints remain available when localStorage fails.
      }
    }
    try {
      window.desktopApi
        .articleEditorRecoveryList({ spaceId, articleId: article.id })
        .forEach((checkpoint) => acceptCandidate(null, checkpoint));
    } catch {
      // The renderer-local checkpoint remains a fallback when the durable store is unavailable.
    }

    const candidates = [...checkpoints.values()].flatMap((candidate) => {
      if (sameCheckpointAsArticle(candidate.checkpoint, article, currentContent)) {
        this.#removeStoredCheckpoint(candidate.checkpoint.sessionEpoch, candidate.key);
        return [];
      }
      return [{ ...candidate, recoverable: recoverableFromCurrent(candidate.checkpoint, article) }];
    });
    const ordered = candidates.sort((left, right) => right.checkpoint.updatedAt - left.checkpoint.updatedAt);
    if (!ordered.length) {
      this.result = { kind: 'none' };
      return;
    }
    const selected = ordered.find((candidate) => candidate.recoverable);
    if (!selected) {
      const conflict = ordered[0];
      this.#sourceCheckpoint = {
        sessionEpoch: conflict.checkpoint.sessionEpoch,
        localKey: conflict.key,
      };
      this.result = {
        kind: 'conflict',
        draft: copyDraft(conflict.checkpoint),
        updatedAt: conflict.checkpoint.updatedAt,
      };
      return;
    }

    this.#checkpoint = {
      ...selected.checkpoint,
      sessionEpoch,
      baseRevisionId: article.revisionId,
      baseContentHash: article.contentHash,
      pendingSave: null,
      updatedAt: Date.now(),
    };
    const migrated = this.#write();
    if (selected.checkpoint.sessionEpoch !== sessionEpoch) {
      if (migrated) this.#removeStoredCheckpoint(selected.checkpoint.sessionEpoch, selected.key);
      else {
        this.#sourceCheckpoint = {
          sessionEpoch: selected.checkpoint.sessionEpoch,
          localKey: selected.key,
        };
      }
    }
    this.result = {
      kind: 'restored',
      draft: copyDraft(this.#checkpoint),
      updatedAt: selected.checkpoint.updatedAt,
    };
  }

  record(input: RecordDraftInput) {
    const parsed = articleEditorRecoveryCheckpointSchema.safeParse({
      schemaVersion: 1,
      spaceId: this.#spaceId,
      articleId: this.#articleId,
      sessionEpoch: this.#sessionEpoch,
      draftSeq: input.draftSeq,
      baseRevisionId: input.baseRevisionId,
      baseContentHash: input.baseContentHash,
      content: input.content,
      media: input.media.map((item) => ({ ...item })),
      elements: input.elements.map((item) => ({ ...item })),
      commentAnchors: input.commentAnchors.map((item) => ({ ...item, anchor: { ...item.anchor } })),
      pendingSave: this.#checkpoint?.pendingSave ?? null,
      updatedAt: Date.now(),
    });
    if (!parsed.success) return false;
    this.#checkpoint = parsed.data;
    return this.#write();
  }

  markPending(input: ArticleRevisionSaveInput) {
    const checkpoint = this.#checkpoint;
    if (!checkpoint || checkpoint.sessionEpoch !== input.sessionEpoch) return true;
    this.#checkpoint = {
      ...checkpoint,
      pendingSave: {
        requestId: input.requestId,
        expectedRevisionId: input.expectedRevisionId,
        contentHash: input.contentHash,
      },
      updatedAt: Date.now(),
    };
    return this.#write();
  }

  acknowledge(input: ArticleRevisionSaveInput, article: ArticleDto) {
    const checkpoint = this.#checkpoint;
    if (!checkpoint || checkpoint.sessionEpoch !== input.sessionEpoch) return true;
    if (checkpoint.draftSeq <= input.draftSeq && sameCheckpointAsRequest(checkpoint, input)) {
      this.clear();
      return true;
    }
    this.#checkpoint = {
      ...checkpoint,
      baseRevisionId: article.revisionId,
      baseContentHash: article.contentHash,
      pendingSave: checkpoint.pendingSave?.requestId === input.requestId ? null : checkpoint.pendingSave,
      updatedAt: Date.now(),
    };
    return this.#write();
  }

  clear() {
    this.#checkpoint = null;
    this.#removeStoredCheckpoint(this.#sessionEpoch, this.#key);
    if (this.#sourceCheckpoint) {
      this.#removeStoredCheckpoint(this.#sourceCheckpoint.sessionEpoch, this.#sourceCheckpoint.localKey);
      this.#sourceCheckpoint = null;
    }
  }

  #removeStoredCheckpoint(sessionEpoch: string, localKey: string | null) {
    try {
      if (localKey) this.#storage?.removeItem(localKey);
    } catch {
      // A failed cleanup leaves only an already-persisted recovery copy.
    }
    try {
      window.desktopApi.articleEditorRecoveryRemove({
        spaceId: this.#spaceId,
        articleId: this.#articleId,
        sessionEpoch,
      });
    } catch {
      // A later load can discard a durable copy that already matches the persisted article.
    }
  }

  #write() {
    if (!this.#checkpoint) return false;
    let durable = false;
    try {
      window.desktopApi.articleEditorRecoveryWrite(this.#checkpoint);
      durable = true;
    } catch {
      // The renderer copy below remains useful for graceful reloads.
    }
    try {
      const serialized = JSON.stringify(this.#checkpoint);
      if (serialized.length <= maxStoredCheckpointCharacters) this.#storage?.setItem(this.#key, serialized);
    } catch {
      // Durable main-process persistence is authoritative for restart recovery.
    }
    return durable;
  }
}

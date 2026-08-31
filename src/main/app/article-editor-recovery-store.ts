import { createHash } from 'node:crypto';
import { readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { readBoundedJsonWithBackupSource, writeJsonAtomically } from '@/main/app/atomic-json-file';
import {
  ARTICLE_EDITOR_RECOVERY_MAX_CHECKPOINTS,
  ARTICLE_EDITOR_RECOVERY_MAXIMUM_BYTES,
  articleEditorRecoveryCheckpointSchema,
  articleEditorRecoveryIdentitySchema,
  articleEditorRecoveryScopeSchema,
  type ArticleEditorRecoveryCheckpoint,
  type ArticleEditorRecoveryIdentity,
  type ArticleEditorRecoveryScope,
} from '@/shared/contracts/article-editor-recovery';

const checkpointFileNamePattern = /^([a-f0-9]{64})\.json(?:\.bak)?$/u;
const checkpointTemporaryFileNamePattern = /^\.[a-f0-9]{64}\.json\.\d+\.[a-f0-9-]+\.tmp$/u;

function storageKey(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function removeFile(filePath: string) {
  try {
    unlinkSync(filePath);
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason;
  }
}

function removeFileBestEffort(filePath: string) {
  try {
    removeFile(filePath);
  } catch {
    // A cleanup failure must not hide an otherwise valid recovery checkpoint.
  }
}

export class ArticleEditorRecoveryStore {
  private readonly directory: string;

  constructor(userDataRoot: string) {
    this.directory = path.join(userDataRoot, 'ui-state', 'article-editor-recovery');
  }

  list(rawScope: ArticleEditorRecoveryScope): ArticleEditorRecoveryCheckpoint[] {
    const scope = articleEditorRecoveryScopeSchema.parse(rawScope);
    const directory = this.scopeDirectory(scope);
    let storedFileNames: string[];
    try {
      storedFileNames = readdirSync(directory);
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw reason;
    }
    for (const fileName of storedFileNames.filter((fileName) => checkpointTemporaryFileNamePattern.test(fileName))) {
      removeFileBestEffort(path.join(directory, fileName));
    }
    const fileNames = [
      ...new Set(
        storedFileNames.flatMap((fileName) => {
          const match = checkpointFileNamePattern.exec(fileName);
          return match ? [`${match[1]}.json`] : [];
        }),
      ),
    ];
    const candidates = fileNames
      .flatMap((fileName) => {
        const filePath = path.join(directory, fileName);
        const stored = readBoundedJsonWithBackupSource(
          filePath,
          ARTICLE_EDITOR_RECOVERY_MAXIMUM_BYTES,
          (value) => articleEditorRecoveryCheckpointSchema.safeParse(value).success,
        );
        const parsed = articleEditorRecoveryCheckpointSchema.safeParse(stored?.value);
        if (!parsed.success || parsed.data.spaceId !== scope.spaceId || parsed.data.articleId !== scope.articleId) {
          return [];
        }
        if (stored?.source === 'backup') {
          try {
            removeFile(filePath);
            writeJsonAtomically(filePath, parsed.data);
            removeFileBestEffort(`${filePath}.bak`);
          } catch {
            // The valid backup remains discoverable if repairing the primary fails.
          }
        } else {
          removeFileBestEffort(`${filePath}.bak`);
        }
        return [{ checkpoint: parsed.data, fileName }];
      })
      .sort((left, right) => right.checkpoint.updatedAt - left.checkpoint.updatedAt);
    const retained = candidates.slice(0, ARTICLE_EDITOR_RECOVERY_MAX_CHECKPOINTS);
    const retainedNames = new Set(retained.map((candidate) => candidate.fileName));
    for (const fileName of fileNames) {
      if (retainedNames.has(fileName)) continue;
      const filePath = path.join(directory, fileName);
      removeFileBestEffort(filePath);
      removeFileBestEffort(`${filePath}.bak`);
    }
    return retained.map((candidate) => candidate.checkpoint);
  }

  write(rawCheckpoint: ArticleEditorRecoveryCheckpoint) {
    const checkpoint = articleEditorRecoveryCheckpointSchema.parse(rawCheckpoint);
    if (Buffer.byteLength(JSON.stringify(checkpoint), 'utf8') > ARTICLE_EDITOR_RECOVERY_MAXIMUM_BYTES) {
      throw new Error('Article editor recovery checkpoint exceeds the storage limit');
    }
    writeJsonAtomically(this.filePath(checkpoint), checkpoint);
  }

  remove(rawIdentity: ArticleEditorRecoveryIdentity) {
    const identity = articleEditorRecoveryIdentitySchema.parse(rawIdentity);
    const filePath = this.filePath(identity);
    removeFile(filePath);
    removeFile(`${filePath}.bak`);
  }

  private scopeDirectory(scope: ArticleEditorRecoveryScope) {
    return path.join(this.directory, storageKey(scope.spaceId), storageKey(scope.articleId));
  }

  private filePath(identity: ArticleEditorRecoveryIdentity) {
    return path.join(this.scopeDirectory(identity), `${storageKey(identity.sessionEpoch)}.json`);
  }
}

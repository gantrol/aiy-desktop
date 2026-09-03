import { createHash } from 'node:crypto';
import { readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { readBoundedJsonWithBackupSourceAsync, writeJsonAtomicallyAsync } from '@/main/app/atomic-json-file';
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

async function removeFile(filePath: string) {
  try {
    await unlink(filePath);
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason;
  }
}

async function removeFileBestEffort(filePath: string) {
  try {
    await removeFile(filePath);
  } catch {
    // A cleanup failure must not hide an otherwise valid recovery checkpoint.
  }
}

export class ArticleEditorRecoveryStore {
  private readonly directory: string;

  constructor(userDataRoot: string) {
    this.directory = path.join(userDataRoot, 'ui-state', 'article-editor-recovery');
  }

  async list(rawScope: ArticleEditorRecoveryScope): Promise<ArticleEditorRecoveryCheckpoint[]> {
    const scope = articleEditorRecoveryScopeSchema.parse(rawScope);
    const directory = this.scopeDirectory(scope);
    let storedFileNames: string[];
    try {
      storedFileNames = await readdir(directory);
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw reason;
    }
    for (const fileName of storedFileNames.filter((fileName) => checkpointTemporaryFileNamePattern.test(fileName))) {
      await removeFileBestEffort(path.join(directory, fileName));
    }
    const fileNames = [
      ...new Set(
        storedFileNames.flatMap((fileName) => {
          const match = checkpointFileNamePattern.exec(fileName);
          return match ? [`${match[1]}.json`] : [];
        }),
      ),
    ];
    const candidates: { checkpoint: ArticleEditorRecoveryCheckpoint; fileName: string }[] = [];
    for (const fileName of fileNames) {
      const filePath = path.join(directory, fileName);
      const stored = await readBoundedJsonWithBackupSourceAsync(
        filePath,
        ARTICLE_EDITOR_RECOVERY_MAXIMUM_BYTES,
        (value) => articleEditorRecoveryCheckpointSchema.safeParse(value).success,
      );
      const parsed = articleEditorRecoveryCheckpointSchema.safeParse(stored?.value);
      if (!parsed.success || parsed.data.spaceId !== scope.spaceId || parsed.data.articleId !== scope.articleId) {
        continue;
      }
      if (stored?.source === 'backup') {
        try {
          await removeFile(filePath);
          await writeJsonAtomicallyAsync(filePath, parsed.data);
          await removeFileBestEffort(`${filePath}.bak`);
        } catch {
          // The valid backup remains discoverable if repairing the primary fails.
        }
      } else {
        await removeFileBestEffort(`${filePath}.bak`);
      }
      candidates.push({ checkpoint: parsed.data, fileName });
    }
    candidates.sort((left, right) => right.checkpoint.updatedAt - left.checkpoint.updatedAt);
    const retained = candidates.slice(0, ARTICLE_EDITOR_RECOVERY_MAX_CHECKPOINTS);
    const retainedNames = new Set(retained.map((candidate) => candidate.fileName));
    for (const fileName of fileNames) {
      if (retainedNames.has(fileName)) continue;
      const filePath = path.join(directory, fileName);
      await removeFileBestEffort(filePath);
      await removeFileBestEffort(`${filePath}.bak`);
    }
    return retained.map((candidate) => candidate.checkpoint);
  }

  async write(rawCheckpoint: ArticleEditorRecoveryCheckpoint) {
    const checkpoint = articleEditorRecoveryCheckpointSchema.parse(rawCheckpoint);
    if (Buffer.byteLength(JSON.stringify(checkpoint), 'utf8') > ARTICLE_EDITOR_RECOVERY_MAXIMUM_BYTES) {
      throw new Error('Article editor recovery checkpoint exceeds the storage limit');
    }
    await writeJsonAtomicallyAsync(this.filePath(checkpoint), checkpoint);
  }

  async remove(rawIdentity: ArticleEditorRecoveryIdentity) {
    const identity = articleEditorRecoveryIdentitySchema.parse(rawIdentity);
    const filePath = this.filePath(identity);
    await removeFile(filePath);
    await removeFile(`${filePath}.bak`);
  }

  private scopeDirectory(scope: ArticleEditorRecoveryScope) {
    return path.join(this.directory, storageKey(scope.spaceId), storageKey(scope.articleId));
  }

  private filePath(identity: ArticleEditorRecoveryIdentity) {
    return path.join(this.scopeDirectory(identity), `${storageKey(identity.sessionEpoch)}.json`);
  }
}

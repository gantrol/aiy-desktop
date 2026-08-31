import { copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { ResolvedAssetFile } from '@/main/database/assets/asset-file-repository';
import { safeAssetFileName } from '@/main/database/assets/asset-file-repository';
import { normalizedArticleMediaPath, rewriteArticleImageReferences } from '@/main/creations/article-media-references';
import { writeDirectoryAtomically, writeValidatedFileAtomically } from '@/main/video-documents/export-file-system';
import type { ArticleDto, ArticleExportMarkdownInput, ArticleExportMarkdownResult } from '@/shared/contracts';

interface ArticleExportDatabase {
  getArticle(id: string): ArticleDto;
  resolveAssetFile(assetId: string): ResolvedAssetFile | null;
}

interface SaveDialogResult {
  canceled: boolean;
  filePath?: string;
}

export interface ArticleExportPorts {
  showSaveDialog(options: Electron.SaveDialogOptions): Promise<SaveDialogResult>;
}

function safeArticleStem(value: string) {
  return safeAssetFileName(value, 'article', '.md').slice(0, -3);
}

function markdownFilePath(filePath: string) {
  return path.extname(filePath).toLowerCase() === '.md' ? filePath : `${filePath}.md`;
}

function uniqueAssetName(value: string, fallback: string, extension: string, used: Set<string>) {
  const base = safeAssetFileName(value, fallback, extension);
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const stem = path.basename(base, extension);
  for (let index = 2; index <= 10_000; index += 1) {
    const candidate = `${stem}-${index}${extension}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  throw new Error('Article media names could not be made unique');
}

export class ArticleExportService {
  constructor(
    private readonly database: ArticleExportDatabase,
    private readonly ports: ArticleExportPorts,
  ) {}

  async exportMarkdown(input: ArticleExportMarkdownInput): Promise<ArticleExportMarkdownResult> {
    const article = this.database.getArticle(input.id);
    const stem = safeArticleStem(article.content.title);
    const result = await this.ports.showSaveDialog({
      title: '导出 Markdown',
      defaultPath: `${stem}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) return { status: 'CANCELLED' };

    const destinationPath = markdownFilePath(result.filePath);
    const destinationDirectory = path.dirname(destinationPath);
    let markdown = article.content.markdown;
    let exportedAssetDirectory: string | null = null;

    if (article.content.mediaBindings.length) {
      const usedNames = new Set<string>();
      const resolved = article.content.mediaBindings.map((binding) => {
        const file = this.database.resolveAssetFile(binding.assetId);
        if (!file || !file.mimeType.startsWith('image/')) {
          throw new Error('An article image is unavailable for export');
        }
        const sourceStem = path.basename(binding.path, path.extname(binding.path));
        const name = uniqueAssetName(sourceStem, `image-${binding.assetId}`, file.extension, usedNames);
        return { binding, file, name };
      });
      const bundle = await writeDirectoryAtomically(
        destinationDirectory,
        (collisionIndex) => `${stem}.assets${collisionIndex === 1 ? '' : `-${collisionIndex}`}`,
        async (temporaryDirectory, finalName) => {
          const destinationsByPath = new Map<string, string>();
          const destinationsByAssetId = new Map<string, string>();
          for (const item of resolved) {
            await copyFile(item.file.absolutePath, path.join(temporaryDirectory, item.name));
            const destination = `${finalName}/${item.name}`;
            destinationsByPath.set(normalizedArticleMediaPath(item.binding.path), destination);
            destinationsByAssetId.set(item.binding.assetId, destination);
          }
          markdown = rewriteArticleImageReferences(markdown, destinationsByPath, destinationsByAssetId);
        },
      );
      exportedAssetDirectory = bundle.directoryPath;
    } else {
      markdown = rewriteArticleImageReferences(markdown, new Map(), new Map());
    }

    try {
      const contents = Buffer.from(markdown, 'utf8');
      await writeValidatedFileAtomically(destinationPath, contents, (persisted) => {
        if (!persisted.equals(contents)) throw new Error('Markdown export verification failed');
      });
    } catch (error) {
      if (exportedAssetDirectory) {
        await rm(exportedAssetDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
      throw error;
    }
    return { status: 'SAVED', filePath: destinationPath };
  }
}

import { assertStandaloneMarkdown, importMarkdownContent } from '@/main/creations/import-markdown';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { sha256HexAsync } from '@/main/database/core/storage';
import { imageDimensions } from '@/main/media/image-dimensions';
import { validateDecodablePngAsync } from '@/main/media/png-validation';
import { articleContentSchema } from '@/shared/contracts/article';
import {
  AGENT_INTAKE_IMAGE_BYTES,
  AGENT_INTAKE_MARKDOWN_BYTES,
  type AgentIntakeImportRequest,
} from '@/shared/contracts/agent-intake';

export function intakeError(code: string, message: string) {
  return Object.assign(new Error(message), { code: `AIY_AGENT_INTAKE_${code}` });
}

export function assertIntakeActive(signal: AbortSignal) {
  if (signal.aborted) throw intakeError('CANCELLED', 'Content import was cancelled');
}

export function normalizeIntakePath(value: string) {
  if (!path.isAbsolute(value) || /[\0*?]/u.test(value) || /^[\\/]{2}/u.test(value)) {
    throw intakeError('INVALID_PATH', 'Use one absolute local file path without wildcards or network shares');
  }
  return path.normalize(value);
}

async function readIntakeBytes(filePath: string, limit: number, signal: AbortSignal) {
  assertIntakeActive(signal);
  const before = await lstat(filePath);
  const resolved = await realpath(filePath);
  const samePath =
    process.platform === 'win32' ? resolved.toLowerCase() === filePath.toLowerCase() : resolved === filePath;
  if (!before.isFile() || before.isSymbolicLink() || !samePath) {
    throw intakeError('INVALID_PATH', 'Content must be an ordinary local file without symbolic links');
  }
  const file = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const initial = await file.stat();
    if (!initial.isFile() || initial.ino !== before.ino || initial.dev !== before.dev) {
      throw intakeError('INVALID_PATH', 'Source file changed while opening');
    }
    if (initial.size < 1 || initial.size > limit) throw intakeError('SIZE_LIMIT', 'Source file exceeds the size limit');
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= limit) {
      assertIntakeActive(signal);
      const chunk = Buffer.alloc(Math.min(64 * 1024, limit + 1 - total));
      const { bytesRead } = await file.read(chunk);
      if (!bytesRead) break;
      chunks.push(chunk.subarray(0, bytesRead));
      total += bytesRead;
    }
    const after = await file.stat();
    if (total > limit) throw intakeError('SIZE_LIMIT', 'Source file exceeds the size limit');
    if (initial.size !== after.size || initial.mtimeMs !== after.mtimeMs || initial.ctimeMs !== after.ctimeMs) {
      throw intakeError('SOURCE_CONFLICT', 'Source changed while reading; retry with a new content hash');
    }
    return Buffer.concat(chunks, total);
  } finally {
    await file.close();
  }
}

function decodeText(bytes: Buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw intakeError('INVALID_ENCODING', 'Content must use valid UTF-8');
  }
}

export async function readIntakeSource(request: AgentIntakeImportRequest, signal: AbortSignal) {
  const extension = path.extname(request.path).toLowerCase();
  const article = request.kind === 'ARTICLE' || request.kind === 'OUTLINE';
  if (article ? !['.md', '.markdown'].includes(extension) : extension !== '.png') {
    throw intakeError('UNSUPPORTED_FORMAT', 'Use Markdown for works or PNG for images');
  }
  const bytes = await readIntakeBytes(
    request.path,
    article ? AGENT_INTAKE_MARKDOWN_BYTES : AGENT_INTAKE_IMAGE_BYTES,
    signal,
  );
  if ((await sha256HexAsync(bytes)) !== request.expectedSha256) {
    throw intakeError('SOURCE_CONFLICT', 'Source does not match the selected content hash');
  }
  const title = request.title || path.basename(request.path, extension).slice(0, 200) || 'Untitled';
  if (article) {
    const markdown = decodeText(bytes);
    if (request.kind === 'OUTLINE')
      return { kind: 'OUTLINE', title, content: importMarkdownContent(title, markdown, 'OUTLINE') } as const;
    assertStandaloneMarkdown(markdown);
    const parsed = articleContentSchema.safeParse({
      schemaVersion: 1,
      title,
      markdown,
      mediaBindings: [],
      coverAssetId: null,
    });
    if (!parsed.success) throw intakeError('INVALID_MARKDOWN', 'Markdown exceeds the article content limits');
    return { kind: 'ARTICLE', title, content: parsed.data } as const;
  }
  const dimensions = imageDimensions(bytes, '.png');
  if (!dimensions || dimensions.width > 4_096 || dimensions.height > 4_096) {
    throw intakeError('INVALID_DIMENSIONS', 'PNG dimensions must not exceed 4096 × 4096');
  }
  if (!(await validateDecodablePngAsync(bytes))) throw intakeError('INVALID_IMAGE', 'PNG could not be fully decoded');
  assertIntakeActive(signal);
  return { kind: 'IMAGE_MATERIAL', title, bytes, dimensions } as const;
}

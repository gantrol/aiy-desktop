import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type FileChild,
  type ParagraphChild,
} from 'docx';
import { unified, type Plugin } from 'unified';
import * as remarkGfmModule from 'remark-gfm';
import * as remarkParseModule from 'remark-parse';
import type { ResolvedAssetFile } from '@/main/database/assets/asset-file-repository';
import {
  VideoDocumentExportError,
  exportError,
  normalizeVideoDocumentExportError,
} from '@/main/video-documents/export-errors';
import { writeDirectoryAtomically, writeValidatedFileAtomically } from '@/main/video-documents/export-file-system';
import {
  safeVideoDocumentAssetStem,
  videoDocumentExportFileName,
  videoDocumentMarkdownBundleName,
  type VideoDocumentExportRole,
} from '@/main/video-documents/export-paths';
import { selectVideoDocumentExportNote } from '@/main/video-documents/export-note-selection';
import type {
  VideoDocumentDto,
  VideoDocumentExportInput,
  VideoDocumentExportResult,
  VideoDocumentMediaBinding,
  VideoDocumentRevisionDto,
  VideoDocumentTimedTranscriptContent,
} from '@/shared/contracts/video-document';

const MAX_DOCX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_DOCX_TOTAL_IMAGE_BYTES = 128 * 1024 * 1024;

function resolveUnifiedPlugin(module: unknown, name: string): Plugin {
  let candidate = module;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof candidate === 'function') return candidate as Plugin;
    if (!candidate || typeof candidate !== 'object' || !('default' in candidate)) break;
    candidate = candidate.default;
  }
  throw new TypeError(`${name} did not expose a Unified plugin`);
}

const remarkGfm = resolveUnifiedPlugin(remarkGfmModule, 'remark-gfm');
const remarkParse = resolveUnifiedPlugin(remarkParseModule, 'remark-parse');

export { videoDocumentExportFileName, videoDocumentMarkdownBundleName };
export {
  VideoDocumentExportError,
  normalizeVideoDocumentExportError,
  videoDocumentExportFailure,
  type VideoDocumentExportErrorCode,
  type VideoDocumentExportFailure,
  type VideoDocumentExportFailureCode,
} from '@/main/video-documents/export-errors';

interface SaveDialogResult {
  canceled: boolean;
  filePath?: string;
}

interface DirectoryDialogResult {
  canceled: boolean;
  filePaths: string[];
}

interface VideoDocumentExportDatabase {
  getVideoDocument(documentId: string): VideoDocumentDto;
  getLatestVideoDocumentRevision(branchId: string): VideoDocumentRevisionDto | null;
  resolveAssetFile(assetId: string): ResolvedAssetFile | null;
}

export interface VideoDocumentExportPorts {
  showSaveDialog(options: Electron.SaveDialogOptions): Promise<SaveDialogResult>;
  showDirectoryDialog?(options: Electron.OpenDialogOptions): Promise<DirectoryDialogResult>;
  convertWebpToPng(filePath: string): Promise<Buffer | null>;
}

interface MarkdownNode {
  type: string;
  value?: string;
  depth?: number;
  url?: string;
  alt?: string | null;
  ordered?: boolean;
  start?: number | null;
  children?: MarkdownNode[];
  align?: Array<'left' | 'right' | 'center' | null>;
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
}

interface PreparedDocxImage {
  data: Buffer;
  type: 'png' | 'jpg' | 'gif';
  width: number;
  height: number;
  name: string;
}

interface InlineStyle {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: boolean;
}

interface RenderContext {
  sourceUrl: string | null;
  imagesByPath: Map<string, PreparedDocxImage>;
  bindingsByPath: Map<string, VideoDocumentMediaBinding>;
  quoteDepth: number;
}

function normalizeBindingPath(value: string) {
  const withoutPrefix = value.split(/[?#]/, 1)[0]!.replace(/^\.\//, '');
  try {
    return decodeURIComponent(withoutPrefix);
  } catch {
    return withoutPrefix;
  }
}

function markdownText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/([`*_[\]<>#])/g, '\\$1');
}

function timeLabel(timestampMs: number) {
  const totalSeconds = Math.max(0, Math.floor(timestampMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function timedTranscriptMarkdown(title: string, transcript: VideoDocumentTimedTranscriptContent) {
  const blocks = transcript.cues.map((cue) => {
    const range =
      cue.endTimestampMs > cue.startTimestampMs
        ? `${timeLabel(cue.startTimestampMs)}–${timeLabel(cue.endTimestampMs)}`
        : timeLabel(cue.startTimestampMs);
    const text = cue.text
      .split(/\r?\n/)
      .map((line) => markdownText(line))
      .join('  \n');
    return `**${range}**  \n${text}`;
  });
  return `# ${markdownText(title)}\n\n${blocks.join('\n\n')}\n`;
}

function exportAssetName(binding: VideoDocumentMediaBinding, source: ResolvedAssetFile, index: number) {
  const bindingStem = path.posix.basename(binding.path, path.posix.extname(binding.path));
  const stem = safeVideoDocumentAssetStem(bindingStem || source.assetId);
  return `${String(index + 1).padStart(2, '0')}-${stem}${source.extension}`;
}

function markdownRelativePath(folderName: string, fileName: string) {
  return `./${[folderName, fileName].map((segment) => encodeURIComponent(segment)).join('/')}`;
}

function sourceLink(sourceUrl: string | null, target: string) {
  if (/^https:\/\//i.test(target)) return target;
  const match = /^#t=(\d+(?:\.\d+)?)$/.exec(target);
  if (!match || !sourceUrl) return null;
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== 'https:') return null;
    url.searchParams.set('t', String(Math.floor(Number(match[1]))));
    return url.toString();
  } catch {
    return null;
  }
}

function parseMarkdown(markdown: string) {
  return unified().use(remarkParse).use(remarkGfm).parse(markdown) as unknown as MarkdownNode;
}

function visitMarkdown(node: MarkdownNode, visitor: (candidate: MarkdownNode) => void) {
  visitor(node);
  for (const child of node.children ?? []) visitMarkdown(child, visitor);
}

function referencedMediaBindings(markdownRoot: MarkdownNode, bindings: readonly VideoDocumentMediaBinding[]) {
  const referencedPaths = new Set<string>();
  visitMarkdown(markdownRoot, (node) => {
    if ((node.type === 'image' || node.type === 'link') && node.url) {
      referencedPaths.add(normalizeBindingPath(node.url));
    }
  });
  return bindings.filter((binding) => referencedPaths.has(normalizeBindingPath(binding.path)));
}

function rewriteMarkdownLinks(
  markdown: string,
  markdownRoot: MarkdownNode,
  sourceUrl: string | null,
  mediaDestinations: ReadonlyMap<string, string>,
  sourceVideoBindings: ReadonlyMap<string, VideoDocumentMediaBinding>,
) {
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  visitMarkdown(markdownRoot, (node) => {
    if ((node.type !== 'link' && node.type !== 'image') || !node.url) return;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined || start < 0 || end > markdown.length || start >= end) return;
    const source = markdown.slice(start, end);

    if (node.type === 'link' && /^#t=\d+(?:\.\d+)?$/.test(node.url)) {
      const match = /^\[([\s\S]*)\]\(\s*#t=\d+(?:\.\d+)?\s*\)$/.exec(source);
      if (!match) return;
      const external = sourceLink(sourceUrl, node.url);
      replacements.push({ start, end, value: external ? `[${match[1]}](<${external}>)` : match[1]! });
      return;
    }

    const normalizedPath = normalizeBindingPath(node.url);
    const sourceVideo = sourceVideoBindings.get(normalizedPath);
    if (node.type === 'link' && sourceVideo) {
      const labelMatch = /^\[([\s\S]*)\]\(/.exec(source);
      if (!labelMatch) return;
      const timestamp = sourceVideo.timestampMs === null ? null : timeLabel(sourceVideo.timestampMs);
      const external =
        sourceVideo.timestampMs === null ? sourceUrl : sourceLink(sourceUrl, `#t=${sourceVideo.timestampMs / 1_000}`);
      const label = labelMatch[1]!;
      replacements.push({
        start,
        end,
        value:
          external && /^https:\/\//i.test(external)
            ? `[${label}](<${external}>)`
            : `${label}${timestamp ? ` (${timestamp})` : ''}`,
      });
      return;
    }

    const destination = mediaDestinations.get(normalizedPath);
    if (!destination) return;
    const relativeUrlOffset = source.indexOf(node.url);
    if (relativeUrlOffset < 0) return;
    replacements.push({
      start: start + relativeUrlOffset,
      end: start + relativeUrlOffset + node.url.length,
      value: destination,
    });
  });
  let result = markdown;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    result = `${result.slice(0, replacement.start)}${replacement.value}${result.slice(replacement.end)}`;
  }
  return result;
}

function styledTextRun(value: string, style: InlineStyle) {
  return new TextRun({
    text: value,
    bold: style.bold,
    italics: style.italics,
    strike: style.strike,
    font: style.code ? 'Consolas' : undefined,
    shading: style.code ? { fill: 'F2F2F2' } : undefined,
    color: style.link ? '0563C1' : undefined,
    underline: style.link ? {} : undefined,
  });
}

function preparedImageRun(image: PreparedDocxImage, alt: string | null | undefined) {
  return new ImageRun({
    type: image.type,
    data: image.data,
    transformation: { width: image.width, height: image.height },
    altText: { name: image.name, title: alt || image.name, description: alt || image.name },
  });
}

function inlineImage(node: MarkdownNode, context: RenderContext): ParagraphChild[] {
  const image = node.url ? context.imagesByPath.get(normalizeBindingPath(node.url)) : undefined;
  if (!image) return node.alt ? [new TextRun({ text: node.alt, italics: true, color: '666666' })] : [];
  return [preparedImageRun(image, node.alt)];
}

function inlineVideo(node: MarkdownNode, binding: VideoDocumentMediaBinding, context: RenderContext) {
  const children: ParagraphChild[] = [];
  const poster = context.imagesByPath.get(normalizeBindingPath(binding.path));
  if (poster) children.push(preparedImageRun(poster, path.basename(binding.path)), new TextRun({ break: 1 }));
  const label = inlineChildren(node.children ?? [], context);
  children.push(...label);
  if (binding.timestampMs !== null) {
    if (label.length > 0) children.push(new TextRun({ text: '  ' }));
    const timestamp = styledTextRun(timeLabel(binding.timestampMs), {});
    const link = sourceLink(context.sourceUrl, `#t=${binding.timestampMs / 1_000}`);
    children.push(link ? new ExternalHyperlink({ link, children: [timestamp] }) : timestamp);
  }
  return children;
}

function inlineNode(node: MarkdownNode, context: RenderContext, style: InlineStyle): ParagraphChild[] {
  if (node.type === 'text') return [styledTextRun(node.value ?? '', style)];
  if (node.type === 'strong' || node.type === 'emphasis' || node.type === 'delete') {
    return inlineChildren(node.children ?? [], context, {
      ...style,
      bold: style.bold || node.type === 'strong',
      italics: style.italics || node.type === 'emphasis',
      strike: style.strike || node.type === 'delete',
    });
  }
  if (node.type === 'inlineCode') return [styledTextRun(node.value ?? '', { ...style, code: true })];
  if (node.type === 'break') return [new TextRun({ break: 1 })];
  if (node.type === 'image') return inlineImage(node, context);
  if (node.type === 'link') {
    const binding = node.url ? context.bindingsByPath.get(normalizeBindingPath(node.url)) : undefined;
    if (binding?.kind === 'VIDEO') return inlineVideo(node, binding, context);
    const link = node.url ? sourceLink(context.sourceUrl, node.url) : null;
    const children = inlineChildren(node.children ?? [], context, link ? { ...style, link: true } : style);
    return link && children.length > 0 ? [new ExternalHyperlink({ link, children })] : children;
  }
  return node.children ? inlineChildren(node.children, context, style) : [];
}

function inlineChildren(nodes: MarkdownNode[], context: RenderContext, style: InlineStyle = {}): ParagraphChild[] {
  return nodes.flatMap((node) => inlineNode(node, context, style));
}

function paragraphOptions(context: RenderContext) {
  if (context.quoteDepth <= 0) return {};
  return {
    indent: { left: 360 * context.quoteDepth },
    border: {
      left: { color: 'B7B7B7', size: 10, space: 8, style: BorderStyle.SINGLE },
    },
  };
}

function renderList(node: MarkdownNode, context: RenderContext, level: number): FileChild[] {
  const result: FileChild[] = [];
  const start = node.start ?? 1;
  for (const [itemIndex, item] of (node.children ?? []).entries()) {
    let firstParagraph = true;
    for (const child of item.children ?? []) {
      if (child.type === 'list') {
        result.push(...renderList(child, context, Math.min(level + 1, 8)));
        continue;
      }
      if (child.type !== 'paragraph') {
        result.push(...renderBlocks([child], context));
        continue;
      }
      const children = inlineChildren(child.children ?? [], context);
      if (node.ordered && firstParagraph) children.unshift(new TextRun({ text: `${start + itemIndex}. ` }));
      result.push(
        new Paragraph({
          children,
          ...(node.ordered ? { indent: { left: 360 * (level + 1), hanging: 240 } } : { bullet: { level } }),
          ...paragraphOptions(context),
          spacing: { after: 80 },
        }),
      );
      firstParagraph = false;
    }
  }
  return result;
}

function renderTable(node: MarkdownNode, context: RenderContext) {
  const rows = (node.children ?? []).map(
    (row, rowIndex) =>
      new TableRow({
        children: (row.children ?? []).map(
          (cell) =>
            new TableCell({
              children: [
                new Paragraph({
                  children: inlineChildren(cell.children ?? [], context, { bold: rowIndex === 0 }),
                  spacing: { before: 60, after: 60 },
                }),
              ],
            }),
        ),
      }),
  );
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

function headingLevel(depth: number | undefined) {
  const levels = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ] as const;
  return levels[Math.min(Math.max((depth ?? 1) - 1, 0), levels.length - 1)]!;
}

function renderBlocks(nodes: MarkdownNode[], context: RenderContext): FileChild[] {
  const result: FileChild[] = [];
  for (const node of nodes) {
    if (node.type === 'heading') {
      result.push(
        new Paragraph({
          heading: headingLevel(node.depth),
          children: inlineChildren(node.children ?? [], context),
          ...paragraphOptions(context),
        }),
      );
      continue;
    }
    if (node.type === 'paragraph') {
      result.push(
        new Paragraph({
          children: inlineChildren(node.children ?? [], context),
          ...paragraphOptions(context),
          spacing: { after: 140, line: 320 },
        }),
      );
      continue;
    }
    if (node.type === 'blockquote') {
      result.push(...renderBlocks(node.children ?? [], { ...context, quoteDepth: context.quoteDepth + 1 }));
      continue;
    }
    if (node.type === 'list') {
      result.push(...renderList(node, context, 0));
      continue;
    }
    if (node.type === 'code') {
      result.push(
        new Paragraph({
          children: [new TextRun({ text: node.value ?? '', font: 'Consolas', size: 19 })],
          shading: { fill: 'F3F3F3' },
          spacing: { before: 100, after: 140 },
        }),
      );
      continue;
    }
    if (node.type === 'thematicBreak') {
      result.push(
        new Paragraph({
          border: { bottom: { color: 'D9D9D9', size: 6, space: 8, style: BorderStyle.SINGLE } },
          spacing: { before: 80, after: 120 },
        }),
      );
      continue;
    }
    if (node.type === 'table') {
      result.push(renderTable(node, context));
      continue;
    }
    if (node.type === 'html') {
      const text = (node.value ?? '').replace(/<[^>]+>/g, '').trim();
      if (text) result.push(new Paragraph({ text }));
      continue;
    }
    if (node.children) result.push(...renderBlocks(node.children, context));
  }
  return result;
}

function fittedImageDimensions(width: number, height: number) {
  const validWidth = Math.max(1, width);
  const validHeight = Math.max(1, height);
  const scale = Math.min(600 / validWidth, 720 / validHeight, 1);
  return { width: Math.max(1, Math.round(validWidth * scale)), height: Math.max(1, Math.round(validHeight * scale)) };
}

function transcriptDocxChildren(title: string, transcript: VideoDocumentTimedTranscriptContent) {
  const children: FileChild[] = [new Paragraph({ heading: HeadingLevel.TITLE, text: title })];
  for (const cue of transcript.cues) {
    const range =
      cue.endTimestampMs > cue.startTimestampMs
        ? `${timeLabel(cue.startTimestampMs)}–${timeLabel(cue.endTimestampMs)}`
        : timeLabel(cue.startTimestampMs);
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `${range}  `, bold: true, color: '6B4D5D' }), new TextRun({ text: cue.text })],
        spacing: { after: 120, line: 300 },
      }),
    );
  }
  return children;
}

function documentFile(title: string, children: FileChild[]) {
  return new Document({
    title,
    creator: 'AIY',
    description: 'Video document export',
    styles: {
      default: {
        document: {
          run: { font: { ascii: 'Aptos', eastAsia: 'Microsoft YaHei', hAnsi: 'Aptos' }, size: 22 },
          paragraph: { spacing: { after: 120, line: 300 } },
        },
      },
    },
    sections: [
      {
        properties: { page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
        children,
      },
    ],
  });
}

export function validateDocxArchive(buffer: Buffer) {
  const invalid = () => {
    throw exportError('VIDEO_DOCUMENT_EXPORT_DOCX_INVALID');
  };
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) invalid();

  let endOffset = -1;
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0 || endOffset + 22 > buffer.length) invalid();

  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  if (entryCount === 0 || centralOffset + centralSize > endOffset || centralOffset >= buffer.length) invalid();

  const entries = new Set<string>();
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) invalid();
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (nextOffset > buffer.length) invalid();
    entries.add(buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    offset = nextOffset;
  }

  for (const required of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']) {
    if (!entries.has(required)) invalid();
  }
}

export class VideoDocumentExportService {
  constructor(
    private readonly database: VideoDocumentExportDatabase,
    private readonly ports: VideoDocumentExportPorts,
  ) {}

  async export(input: VideoDocumentExportInput): Promise<VideoDocumentExportResult> {
    try {
      return await this.exportSelection(input);
    } catch (error) {
      throw normalizeVideoDocumentExportError(error);
    }
  }

  private async exportSelection(input: VideoDocumentExportInput): Promise<VideoDocumentExportResult> {
    const { document, revision, role } = this.resolveSelection(input);
    const markdownRoot = revision.content.format === 'MARKDOWN' ? parseMarkdown(revision.content.markdown) : null;
    const referencedBindings =
      revision.content.format === 'MARKDOWN' && markdownRoot
        ? referencedMediaBindings(markdownRoot, revision.content.mediaBindings)
        : [];
    const mediaFiles = this.resolveMediaFiles(referencedBindings, input.format, document.source.asset.id);

    if (input.format === 'MARKDOWN') {
      const parentDirectory = await this.selectMarkdownParentDirectory(document.title, role);
      if (!parentDirectory) return { status: 'cancelled' };
      let saved: Awaited<ReturnType<typeof writeDirectoryAtomically>>;
      try {
        saved = await this.exportMarkdown(
          document,
          revision,
          markdownRoot,
          referencedBindings,
          mediaFiles,
          parentDirectory,
          role,
        );
      } catch (error) {
        throw normalizeVideoDocumentExportError(error, 'GENERAL', parentDirectory);
      }
      return {
        status: 'saved',
        format: input.format,
        fileName: `${saved.directoryName}.md`,
        outputPath: saved.directoryPath,
        outputKind: 'DIRECTORY',
      };
    }

    const defaultName = videoDocumentExportFileName(document.title, role, 'DOCX');
    const result = await this.ports.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'Word', extensions: ['docx'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return { status: 'cancelled' };
    this.assertDestinationExtension(result.filePath, 'DOCX');
    try {
      await this.exportDocx(document, revision, markdownRoot, referencedBindings, mediaFiles, result.filePath);
    } catch (error) {
      throw normalizeVideoDocumentExportError(error, 'DESTINATION_REPLACE', result.filePath);
    }
    return {
      status: 'saved',
      format: input.format,
      fileName: path.basename(result.filePath),
      outputPath: result.filePath,
      outputKind: 'FILE',
    };
  }

  private async selectMarkdownParentDirectory(title: string, role: VideoDocumentExportRole) {
    const bundleName = videoDocumentMarkdownBundleName(title, role);
    if (this.ports.showDirectoryDialog) {
      const result = await this.ports.showDirectoryDialog({
        defaultPath: bundleName,
        properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    }

    const result = await this.ports.showSaveDialog({
      defaultPath: `${bundleName}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      properties: ['createDirectory'],
    });
    return result.canceled || !result.filePath ? null : path.dirname(result.filePath);
  }

  private resolveSelection(input: VideoDocumentExportInput) {
    const document = this.database.getVideoDocument(input.documentId);
    const branch = document.branches.find((candidate) => candidate.id === input.branchId);
    if (!branch || (branch.role !== 'CLEAN_TRANSCRIPT' && branch.role !== 'ARTICLE')) {
      throw exportError('VIDEO_DOCUMENT_EXPORT_BRANCH_UNSUPPORTED');
    }
    if (branch.latestDraftRevisionId !== input.revisionId) {
      throw exportError('VIDEO_DOCUMENT_EXPORT_DOCUMENT_CHANGED', { retryable: true });
    }
    const revision = this.database.getLatestVideoDocumentRevision(branch.id);
    if (!revision || revision.id !== input.revisionId || revision.branchId !== branch.id) {
      throw exportError('VIDEO_DOCUMENT_EXPORT_DOCUMENT_CHANGED', { retryable: true });
    }
    if (branch.role === 'CLEAN_TRANSCRIPT' && revision.content.format !== 'TIMED_TRANSCRIPT') {
      throw exportError('VIDEO_DOCUMENT_EXPORT_DOCUMENT_CHANGED', { retryable: true });
    }
    if (branch.role === 'ARTICLE' && !['MARKDOWN', 'NOTE_COLLECTION'].includes(revision.content.format)) {
      throw exportError('VIDEO_DOCUMENT_EXPORT_DOCUMENT_CHANGED', { retryable: true });
    }
    const selection = selectVideoDocumentExportNote(document, revision, input.noteId);
    if (!selection) throw exportError('VIDEO_DOCUMENT_EXPORT_DOCUMENT_CHANGED', { retryable: true });
    return { ...selection, role: branch.role };
  }

  private assertDestinationExtension(filePath: string, format: VideoDocumentExportInput['format']) {
    const expected = format === 'MARKDOWN' ? '.md' : '.docx';
    if (path.extname(filePath).toLowerCase() !== expected) {
      throw exportError('VIDEO_DOCUMENT_EXPORT_EXTENSION_INVALID', { retryable: true });
    }
  }

  private resolveMediaFiles(
    bindings: readonly VideoDocumentMediaBinding[],
    format: VideoDocumentExportInput['format'],
    sourceAssetId: string,
  ) {
    const assetIds = new Set<string>();
    for (const binding of bindings) {
      if (format === 'MARKDOWN') {
        if (binding.kind !== 'VIDEO' || binding.assetId !== sourceAssetId) assetIds.add(binding.assetId);
      } else if (binding.kind === 'IMAGE') assetIds.add(binding.assetId);
      else if (binding.posterAssetId) assetIds.add(binding.posterAssetId);
    }
    return new Map([...assetIds].map((assetId) => [assetId, this.database.resolveAssetFile(assetId)]));
  }

  private async exportMarkdown(
    document: VideoDocumentDto,
    revision: VideoDocumentRevisionDto,
    markdownRoot: MarkdownNode | null,
    referencedBindings: readonly VideoDocumentMediaBinding[],
    mediaFiles: Map<string, ResolvedAssetFile | null>,
    parentDirectory: string,
    role: VideoDocumentExportRole,
  ) {
    return writeDirectoryAtomically(
      parentDirectory,
      (collisionIndex) => videoDocumentMarkdownBundleName(document.title, role, collisionIndex),
      async (temporaryDirectory, finalName) => {
        const markdownPath = path.join(temporaryDirectory, `${finalName}.md`);
        if (revision.content.format === 'TIMED_TRANSCRIPT') {
          await writeFile(markdownPath, timedTranscriptMarkdown(document.title, revision.content), { flag: 'wx' });
          return;
        }
        if (revision.content.format !== 'MARKDOWN') throw exportError('VIDEO_DOCUMENT_EXPORT_BRANCH_UNSUPPORTED');

        if (!markdownRoot) throw exportError('VIDEO_DOCUMENT_EXPORT_FAILED');
        const sourceVideoBindings = new Map<string, VideoDocumentMediaBinding>();
        const copiedBindings = referencedBindings.filter((binding) => {
          if (binding.kind !== 'VIDEO' || binding.assetId !== document.source.asset.id) return true;
          sourceVideoBindings.set(normalizeBindingPath(binding.path), binding);
          return false;
        });
        const mediaDestinations = new Map<string, string>();
        if (copiedBindings.length > 0) {
          const assetsPath = path.join(temporaryDirectory, 'assets');
          await mkdir(assetsPath);
          for (const [index, binding] of copiedBindings.entries()) {
            const source = mediaFiles.get(binding.assetId);
            if (!source) throw exportError('VIDEO_DOCUMENT_EXPORT_MEDIA_UNAVAILABLE');
            const fileName = exportAssetName(binding, source, index);
            try {
              await copyFile(source.absolutePath, path.join(assetsPath, fileName));
            } catch (error) {
              throw normalizeVideoDocumentExportError(error, 'SOURCE_MEDIA');
            }
            mediaDestinations.set(normalizeBindingPath(binding.path), markdownRelativePath('assets', fileName));
          }
        }
        const markdown = rewriteMarkdownLinks(
          revision.content.markdown,
          markdownRoot,
          revision.content.sourceUrl,
          mediaDestinations,
          sourceVideoBindings,
        );
        await writeFile(markdownPath, markdown.endsWith('\n') ? markdown : `${markdown}\n`, { flag: 'wx' });
      },
    );
  }

  private async exportDocx(
    document: VideoDocumentDto,
    revision: VideoDocumentRevisionDto,
    markdownRoot: MarkdownNode | null,
    referencedBindings: readonly VideoDocumentMediaBinding[],
    mediaFiles: Map<string, ResolvedAssetFile | null>,
    destinationPath: string,
  ) {
    let buffer: Buffer;
    try {
      let children: FileChild[];
      if (revision.content.format === 'TIMED_TRANSCRIPT') {
        children = transcriptDocxChildren(document.title, revision.content);
      } else {
        if (revision.content.format !== 'MARKDOWN') {
          throw exportError('VIDEO_DOCUMENT_EXPORT_BRANCH_UNSUPPORTED');
        }
        if (!markdownRoot) throw exportError('VIDEO_DOCUMENT_EXPORT_DOCX_BUILD_FAILED');
        const imagesByPath = await this.prepareDocxImages(revision, referencedBindings, mediaFiles);
        children = renderBlocks(markdownRoot.children ?? [], {
          sourceUrl: revision.content.sourceUrl,
          imagesByPath,
          bindingsByPath: new Map(
            referencedBindings.map((binding) => [normalizeBindingPath(binding.path), binding] as const),
          ),
          quoteDepth: 0,
        });
        if (children.length === 0) {
          children.push(new Paragraph({ heading: HeadingLevel.TITLE, text: document.title }));
        }
      }
      buffer = await Packer.toBuffer(documentFile(document.title, children));
    } catch (error) {
      if (error instanceof VideoDocumentExportError) throw error;
      throw exportError('VIDEO_DOCUMENT_EXPORT_DOCX_BUILD_FAILED', { cause: error });
    }

    try {
      await writeValidatedFileAtomically(destinationPath, buffer, validateDocxArchive);
    } catch (error) {
      throw normalizeVideoDocumentExportError(error, 'DESTINATION_REPLACE', destinationPath);
    }
  }

  private async prepareDocxImages(
    revision: VideoDocumentRevisionDto,
    referencedBindings: readonly VideoDocumentMediaBinding[],
    mediaFiles: Map<string, ResolvedAssetFile | null>,
  ) {
    if (revision.content.format !== 'MARKDOWN') return new Map<string, PreparedDocxImage>();
    const mediaById = new Map(revision.media.map((media) => [media.assetId, media]));
    const imagesByPath = new Map<string, PreparedDocxImage>();
    let totalBytes = 0;
    for (const binding of referencedBindings) {
      const imageAssetId = binding.kind === 'IMAGE' ? binding.assetId : binding.posterAssetId;
      if (!imageAssetId) continue;
      const metadata = mediaById.get(imageAssetId);
      const source = mediaFiles.get(imageAssetId);
      if (!metadata || !source || !source.mimeType.startsWith('image/')) {
        throw exportError('VIDEO_DOCUMENT_EXPORT_MEDIA_UNAVAILABLE');
      }
      if (metadata.byteSize > MAX_DOCX_IMAGE_BYTES) {
        throw exportError('VIDEO_DOCUMENT_EXPORT_IMAGE_TOO_LARGE');
      }
      totalBytes += metadata.byteSize;
      if (totalBytes > MAX_DOCX_TOTAL_IMAGE_BYTES) throw exportError('VIDEO_DOCUMENT_EXPORT_TOO_LARGE');
      let data: Buffer;
      let type: PreparedDocxImage['type'];
      if (source.mimeType === 'image/webp') {
        const converted = await this.ports.convertWebpToPng(source.absolutePath);
        if (!converted) throw exportError('VIDEO_DOCUMENT_EXPORT_MEDIA_UNAVAILABLE');
        data = converted;
        type = 'png';
      } else {
        try {
          data = await readFile(source.absolutePath);
        } catch (error) {
          throw normalizeVideoDocumentExportError(error, 'SOURCE_MEDIA');
        }
        type = source.mimeType === 'image/jpeg' ? 'jpg' : source.mimeType === 'image/gif' ? 'gif' : 'png';
      }
      const dimensions = fittedImageDimensions(metadata.width, metadata.height);
      imagesByPath.set(normalizeBindingPath(binding.path), {
        data,
        type,
        ...dimensions,
        name: path.basename(binding.path),
      });
    }
    return imagesByPath;
  }
}

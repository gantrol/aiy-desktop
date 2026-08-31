import { createHash } from 'node:crypto';
import * as remarkParseModule from 'remark-parse';
import { unified, type Plugin } from 'unified';
import type { CodexVisualizationThreadArtifactRecord } from '@/main/extensions/codex-visualization-discovery/scan';

const MAX_DIAGRAM_BYTES = 512 * 1024;
const MAX_ARTIFACTS_PER_MESSAGE = 64;

interface MarkdownNode {
  type: string;
  lang?: string | null;
  value?: string;
  children?: MarkdownNode[];
}

interface DiagramSyntax {
  extension: '.mmd' | '.puml' | '.dot' | '.d2';
  stem: 'mermaid' | 'plantuml' | 'graphviz' | 'd2';
}

function resolveUnifiedPlugin(module: unknown, name: string): Plugin {
  let candidate = module;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof candidate === 'function') return candidate as Plugin;
    if (!candidate || typeof candidate !== 'object' || !('default' in candidate)) break;
    candidate = candidate.default;
  }
  throw new TypeError(`${name} did not expose a Unified plugin`);
}

const remarkParse = resolveUnifiedPlugin(remarkParseModule, 'remark-parse');

function parseMarkdown(markdown: string) {
  return unified().use(remarkParse).parse(markdown) as unknown as MarkdownNode;
}

function visitMarkdown(node: MarkdownNode, visitor: (candidate: MarkdownNode) => void) {
  visitor(node);
  for (const child of node.children ?? []) visitMarkdown(child, visitor);
}

function diagramSyntax(language: string | null | undefined, sourceText: string): DiagramSyntax | null {
  const normalized =
    language
      ?.trim()
      .toLowerCase()
      .split(/[\s,{]/, 1)[0]
      ?.replace(/^\./, '') ?? '';
  const trimmed = sourceText.trim();
  if (!trimmed || Buffer.byteLength(sourceText, 'utf8') > MAX_DIAGRAM_BYTES) return null;
  if (normalized === 'mermaid' || normalized === 'mmd') return { extension: '.mmd', stem: 'mermaid' };
  if (normalized === 'plantuml' || normalized === 'puml' || normalized === 'uml') {
    return /^\s*@startuml\b/i.test(sourceText) && /@enduml\s*$/i.test(sourceText)
      ? { extension: '.puml', stem: 'plantuml' }
      : null;
  }
  if (normalized === 'dot' || normalized === 'graphviz' || normalized === 'gv') {
    return /^\s*(?:strict\s+)?(?:di)?graph\b/i.test(sourceText) ? { extension: '.dot', stem: 'graphviz' } : null;
  }
  if (normalized === 'd2') return { extension: '.d2', stem: 'd2' };
  return null;
}

function stableMessageSegment(messageId: string | undefined, timestamp: string) {
  if (messageId && /^[a-z0-9_-]{1,80}$/i.test(messageId)) return messageId;
  return createHash('sha256')
    .update(messageId ?? '')
    .update('\0')
    .update(timestamp)
    .digest('hex')
    .slice(0, 20);
}

export function extractMessageDiagrams(
  sessionId: string,
  messageId: string | undefined,
  timestamp: string,
  markdown: string,
) {
  const artifacts: CodexVisualizationThreadArtifactRecord[] = [];
  let blockIndex = 0;
  const messageSegment = stableMessageSegment(messageId, timestamp);
  let document: MarkdownNode;
  try {
    document = parseMarkdown(markdown);
  } catch {
    return artifacts;
  }
  visitMarkdown(document, (node) => {
    if (node.type !== 'code' || typeof node.value !== 'string' || artifacts.length >= MAX_ARTIFACTS_PER_MESSAGE) return;
    const syntax = diagramSyntax(node.lang, node.value);
    if (!syntax) return;
    blockIndex += 1;
    const sequence = String(blockIndex).padStart(2, '0');
    const fileName = `${syntax.stem}-${sequence}${syntax.extension}`;
    const relativePath = `thread-diagrams/${messageSegment}/${fileName}`;
    const sourceText = node.value.endsWith('\n') ? node.value : `${node.value}\n`;
    const id = createHash('sha256')
      .update(sessionId)
      .update('\0thread-message\0')
      .update(messageSegment)
      .update('\0')
      .update(String(blockIndex))
      .update('\0')
      .update(sourceText)
      .digest('hex');
    artifacts.push({
      id,
      sessionId,
      relativePath,
      sourceKind: 'THREAD_MESSAGE',
      sourceText,
      fileName,
      extension: syntax.extension,
      kind: 'DIAGRAM_SOURCE',
      role: 'PRIMARY',
      byteSize: Buffer.byteLength(sourceText, 'utf8'),
      modifiedAt: new Date(timestamp).toISOString(),
    });
  });
  return artifacts;
}

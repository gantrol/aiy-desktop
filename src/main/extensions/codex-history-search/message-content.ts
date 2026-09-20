import path from 'node:path';
import { z } from 'zod';
import { codexHistoryMediaUrl } from '@/main/extensions/codex-history-search/media-access';
import type {
  CodexHistoryContextKind,
  CodexHistoryMessageBlock,
  CodexHistoryMessagePhase,
} from '@/shared/contracts/codex-history-search';

export const MAX_CODEX_HISTORY_MESSAGE_TEXT_CHARACTERS = 1024 * 1024;
export const CODEX_HISTORY_PROJECTED_ITEM_TYPES = ['userMessage', 'agentMessage', 'plan', 'imageGeneration'] as const;
export type CodexHistoryProjectedItemType = (typeof CODEX_HISTORY_PROJECTED_ITEM_TYPES)[number];

const MAX_SOURCE_MESSAGE_TEXT_CHARACTERS = 4 * 1024 * 1024;
const requestHeaderPattern = /^## My request(?: for Codex)?:[ \t]*\r?$/gmu;
const localMarkdownImagePattern = /!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\)/gu;
const markdownImageTargetPattern = /!\[([^\]]*)\]\((?:<[^>]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\)/gu;
const markdownLinkTargetPattern = /\[([^\]]+)\]\((?:<[^>]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\)/gu;
const imageExtensions = new Set(['.avif', '.bmp', '.gif', '.jpeg', '.jpg', '.png', '.webp']);

const projectedItemSchema = z
  .object({
    type: z.string().min(1).max(100),
    id: z.string().min(1).max(512).optional(),
  })
  .passthrough();
const projectedUserMessageSchema = projectedItemSchema.extend({
  type: z.literal('userMessage'),
  content: z.array(z.unknown()).max(256),
});
const projectedAgentMessageSchema = projectedItemSchema.extend({
  type: z.literal('agentMessage'),
  text: z.string().max(MAX_SOURCE_MESSAGE_TEXT_CHARACTERS),
  phase: z.string().max(64).nullable().optional(),
});
const projectedPlanSchema = projectedItemSchema.extend({
  type: z.literal('plan'),
  text: z.string().max(MAX_SOURCE_MESSAGE_TEXT_CHARACTERS),
});
const projectedImageGenerationSchema = projectedItemSchema.extend({
  type: z.literal('imageGeneration'),
  status: z.unknown().optional(),
  revisedPrompt: z.unknown().optional(),
  savedPath: z.unknown().optional(),
  failure: z.unknown().optional(),
});

interface UserTextResult {
  primaryText: string;
  blocks: CodexHistoryMessageBlock[];
}

export interface ParsedCodexHistoryMessage {
  messageId: string | null;
  role: 'USER' | 'ASSISTANT';
  text: string;
  searchText: string;
  phase: CodexHistoryMessagePhase | null;
  blocks: CodexHistoryMessageBlock[];
}

function bounded(value: string, maximum = MAX_CODEX_HISTORY_MESSAGE_TEXT_CHARACTERS) {
  return value.trim().slice(0, maximum);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function displayValue(value: unknown) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function markdownBlock(text: string): CodexHistoryMessageBlock | null {
  const normalized = bounded(text);
  return normalized ? { type: 'MARKDOWN', text: rewriteLocalMarkdownImages(normalized) } : null;
}

function contextBlock(
  kind: CodexHistoryContextKind,
  options: {
    title?: string;
    text?: string;
    reference?: string | null;
    items?: Extract<CodexHistoryMessageBlock, { type: 'CONTEXT' }>['items'];
  },
): CodexHistoryMessageBlock {
  return {
    type: 'CONTEXT',
    kind,
    title: bounded(options.title ?? '', 500),
    text: bounded(options.text ?? ''),
    reference: options.reference ? bounded(options.reference, 32_768) : null,
    items: (options.items ?? []).slice(0, 256),
  };
}

function localMediaUrl(filePath: string) {
  const url = codexHistoryMediaUrl(filePath);
  return url.length <= 65_536 ? url : null;
}

function rewriteLocalMarkdownImages(text: string) {
  return text.replace(localMarkdownImagePattern, (whole, alt: string, anglePath?: string, barePath?: string) => {
    const candidate = anglePath ?? barePath ?? '';
    if (!path.isAbsolute(candidate) || !imageExtensions.has(path.extname(candidate).toLowerCase())) return whole;
    const mediaUrl = localMediaUrl(candidate);
    return mediaUrl ? `![${alt}](${mediaUrl})` : whole;
  });
}

function stripMarkdownLinkTargets(value: string) {
  return value.replace(markdownImageTargetPattern, '$1').replace(markdownLinkTargetPattern, '$1');
}

function stripInlineLinkTargets(line: string) {
  let result = '';
  let offset = 0;
  while (offset < line.length) {
    const opening = /`+/u.exec(line.slice(offset));
    if (!opening || opening.index === undefined) return result + stripMarkdownLinkTargets(line.slice(offset));
    const start = offset + opening.index;
    const ticks = opening[0];
    const end = line.indexOf(ticks, start + ticks.length);
    if (end < 0) return result + stripMarkdownLinkTargets(line.slice(offset));
    result += stripMarkdownLinkTargets(line.slice(offset, start));
    result += line.slice(start, end + ticks.length);
    offset = end + ticks.length;
  }
  return result;
}

function visibleMarkdownText(text: string) {
  let fence = '';
  return text
    .split(/\r?\n/u)
    .map((line) => {
      const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1]?.[0] ?? '';
      if (!fence && marker) {
        fence = marker;
        return line;
      }
      if (fence) {
        if (marker === fence) fence = '';
        return line;
      }
      return stripInlineLinkTargets(line);
    })
    .join('\n');
}

function recognizedEnvelopePrefix(prefix: string) {
  return /(?:^|\n)(?:# Files (?:mentioned|pasted) by the user:|# In app browser:|# Response annotations:|# Context from my IDE setup:|# Selected text:|## Referenced ChatGPT conversation:)|<(?:response-annotations|send_user_message_question_reply|codex_delegation|realtime_delegation|heartbeat)>/u.test(
    prefix,
  );
}

function splitUserEnvelope(value: string) {
  const trimmed = value.trim();
  const matches = [...trimmed.matchAll(requestHeaderPattern)];
  const match = matches[0];
  if (!match || match.index === undefined)
    return recognizedEnvelopePrefix(trimmed) ? { prefix: trimmed, request: '' } : { prefix: '', request: trimmed };
  const prefix = trimmed.slice(0, match.index).trim();
  if (prefix && !recognizedEnvelopePrefix(prefix)) return { prefix: '', request: trimmed };
  return { prefix, request: trimmed.slice(match.index + match[0].length).trim() };
}

function taggedValue(value: string, tag: string) {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'iu').exec(value);
  return match ? bounded(match[1] ?? '') : '';
}

function parsedJsonArray(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseQuestionReply(value: string): CodexHistoryMessageBlock | null {
  const payload = taggedValue(value, 'send_user_message_question_reply');
  if (!payload) return null;
  const items = parsedJsonArray(payload).flatMap((candidate) => {
    const item = recordValue(candidate);
    if (!item) return [];
    const question = bounded(stringValue(item.question), 32_768);
    const answer = bounded(stringValue(item.answer), 32_768);
    if (!question && !answer) return [];
    return [{ label: question, text: answer, role: 'USER' as const, reference: null }];
  });
  return contextBlock('QUESTION_REPLY', { items, text: items.length ? '' : payload });
}

function parseDelegation(value: string): CodexHistoryMessageBlock | null {
  if (!/<codex_delegation>/iu.test(value)) return null;
  return contextBlock('DELEGATION', {
    text: taggedValue(value, 'input'),
    reference: taggedValue(value, 'source_thread_id') || null,
  });
}

function parseRealtime(value: string): CodexHistoryMessageBlock | null {
  if (!/<realtime_delegation>/iu.test(value)) return null;
  const input = taggedValue(value, 'input');
  const transcript = taggedValue(value, 'transcript_delta');
  return contextBlock('REALTIME', {
    text: input,
    items: transcript ? [{ label: '', text: transcript, role: null, reference: null }] : [],
  });
}

function parseHeartbeat(value: string): CodexHistoryMessageBlock | null {
  if (!/<heartbeat>/iu.test(value)) return null;
  const automationId = taggedValue(value, 'automation_id');
  const currentTime = taggedValue(value, 'current_time_iso');
  return contextBlock('AUTOMATION', {
    title: automationId,
    text: taggedValue(value, 'instructions'),
    items: currentTime ? [{ label: '', text: currentTime, role: null, reference: null }] : [],
  });
}

function parseAnnotations(value: string): CodexHistoryMessageBlock | null {
  const payload = taggedValue(value, 'response-annotations');
  if (!payload) return null;
  const items = parsedJsonArray(payload).flatMap((candidate) => {
    const item = recordValue(candidate);
    if (!item) return [];
    const text = bounded(stringValue(item.text), 32_768);
    const comment = bounded(stringValue(item.annotation) || stringValue(item.comment), 32_768);
    if (!text && !comment) return [];
    const source = recordValue(item.source);
    return [
      {
        label: comment,
        text,
        role: null,
        reference: stringValue(source?.messageId) || stringValue(source?.itemId) || stringValue(item.messageId) || null,
      },
    ];
  });
  return contextBlock('ANNOTATIONS', { items, text: items.length ? '' : payload });
}

function parseBrowserContext(value: string): CodexHistoryMessageBlock | null {
  const wrapper = /<in-app-browser-context\b[^>]*>([\s\S]*?)<\/in-app-browser-context>/iu.exec(value);
  if (!wrapper) return null;
  const body = wrapper[1] ?? '';
  const heading = /^# In app browser:[ \t]*$/mu.exec(body);
  const text = heading?.index === undefined ? body : body.slice(heading.index + heading[0].length);
  const currentUrl = /^- Current URL:\s*(\S+)/mu.exec(text)?.[1] ?? null;
  return contextBlock('BROWSER', { text, reference: currentUrl });
}

function parseChatGptReference(value: string): CodexHistoryMessageBlock | null {
  if (!/^## Referenced ChatGPT conversation:/mu.test(value)) return null;
  const jsonStart = value.indexOf('{');
  if (jsonStart < 0) return contextBlock('CHATGPT_REFERENCE', { text: value });
  let root: Record<string, unknown> | null = null;
  try {
    root = recordValue(JSON.parse(value.slice(jsonStart)) as unknown);
  } catch {
    return contextBlock('CHATGPT_REFERENCE', { text: value.slice(jsonStart) });
  }
  if (!root) return contextBlock('CHATGPT_REFERENCE', { text: value.slice(jsonStart) });
  const prior = recordValue(root.priorConversation);
  const conversation = Array.isArray(prior?.conversation) ? prior.conversation : [];
  const items = conversation.flatMap((candidate) => {
    const message = recordValue(candidate);
    const role: 'USER' | 'ASSISTANT' | null =
      message?.role === 'user' ? 'USER' : message?.role === 'assistant' ? 'ASSISTANT' : null;
    const content = Array.isArray(message?.content) ? message.content : [];
    const text = bounded(
      content
        .map((part) => stringValue(recordValue(part)?.text))
        .filter(Boolean)
        .join('\n'),
    );
    return text ? [{ label: '', text, role, reference: null }] : [];
  });
  return contextBlock('CHATGPT_REFERENCE', {
    title: stringValue(root.title),
    reference: stringValue(root.conversationId) || null,
    items,
  });
}

interface EnvelopeSection {
  kind: CodexHistoryContextKind;
  title: string;
  start: number;
  contentStart: number;
}

function envelopeSections(value: string): EnvelopeSection[] {
  const patterns: Array<[RegExp, CodexHistoryContextKind]> = [
    [/^# Files (?:mentioned|pasted) by the user:[ \t]*$/gmu, 'ATTACHMENTS'],
    [/^# In app browser:[ \t]*$/gmu, 'BROWSER'],
    [/^# Context from my IDE setup:[ \t]*$/gmu, 'IDE'],
    [/^# Selected text:[ \t]*$/gmu, 'SELECTION'],
  ];
  return patterns
    .flatMap(([pattern, kind]) =>
      [...value.matchAll(pattern)].map((match) => ({
        kind,
        title: match[0].replace(/^#+\s*/u, '').replace(/:$/u, ''),
        start: match.index ?? 0,
        contentStart: (match.index ?? 0) + match[0].length,
      })),
    )
    .sort((left, right) => left.start - right.start);
}

function parseOrdinaryEnvelopeSections(value: string) {
  const sections = envelopeSections(value);
  return sections.map((section, index): CodexHistoryMessageBlock => {
    const text = value.slice(section.contentStart, sections[index + 1]?.start ?? value.length).trim();
    if (section.kind !== 'ATTACHMENTS') return contextBlock(section.kind, { title: section.title, text });
    const items = [...text.matchAll(/^## (.*?):\s+(.+)$/gmu)].map((match) => ({
      label: bounded(match[1] ?? '', 500),
      text: '',
      role: null,
      reference: bounded(match[2] ?? '', 32_768) || null,
    }));
    return contextBlock('ATTACHMENTS', { title: section.title, text: items.length ? '' : text, items });
  });
}

function parseEnvelopePrefix(value: string) {
  if (!value.trim()) return [];
  const special = [
    parseChatGptReference(value),
    parseAnnotations(value),
    parseBrowserContext(value),
    parseQuestionReply(value),
    parseDelegation(value),
    parseRealtime(value),
    parseHeartbeat(value),
  ].filter((block): block is CodexHistoryMessageBlock => Boolean(block));
  const ordinary = parseOrdinaryEnvelopeSections(value);
  const specialKinds = new Set(special.flatMap((block) => (block.type === 'CONTEXT' ? [block.kind] : [])));
  const combined = [
    ...special,
    ...ordinary.filter((block) => block.type !== 'CONTEXT' || !specialKinds.has(block.kind)),
  ];
  return combined.length ? combined : [contextBlock('OTHER', { text: value })];
}

function parseUserText(value: string, hasTextElements: boolean): UserTextResult {
  const trimmed = bounded(value);
  if (!trimmed) return { primaryText: '', blocks: [] };
  if (hasTextElements && /^\/\w+/u.test(trimmed)) {
    return { primaryText: '', blocks: [contextBlock('COMMAND', { text: trimmed })] };
  }
  const pureStructured =
    parseQuestionReply(trimmed) ?? parseDelegation(trimmed) ?? parseRealtime(trimmed) ?? parseHeartbeat(trimmed);
  if (
    pureStructured &&
    /^<(?:send_user_message_question_reply|codex_delegation|realtime_delegation|heartbeat)>/u.test(trimmed)
  ) {
    return { primaryText: '', blocks: [pureStructured] };
  }
  const { prefix, request } = splitUserEnvelope(trimmed);
  const blocks = parseEnvelopePrefix(prefix);
  const requestBlock = markdownBlock(request);
  if (requestBlock) blocks.push(requestBlock);
  return { primaryText: request, blocks };
}

function mediaBlockFromUserPart(part: Record<string, unknown>): CodexHistoryMessageBlock | null {
  if (part.type === 'localImage') {
    const source = bounded(stringValue(part.path), 32_768);
    return source
      ? {
          type: 'MEDIA',
          kind: 'LOCAL_IMAGE',
          source,
          mediaUrl: localMediaUrl(source),
          alt: path.basename(source),
          status: null,
          prompt: '',
          error: null,
        }
      : null;
  }
  if (part.type !== 'image') return null;
  const url = stringValue(part.url);
  const embedded = /^data:image\//iu.test(url);
  return {
    type: 'MEDIA',
    kind: embedded ? 'EMBEDDED_IMAGE' : 'REMOTE_IMAGE',
    source: embedded ? null : bounded(url, 32_768) || null,
    mediaUrl: null,
    alt: '',
    status: null,
    prompt: '',
    error: null,
  };
}

function parseUserMessage(value: unknown): ParsedCodexHistoryMessage | null {
  const parsed = projectedUserMessageSchema.safeParse(value);
  if (!parsed.success) return null;
  const blocks: CodexHistoryMessageBlock[] = [];
  const primary: string[] = [];
  for (const candidate of parsed.data.content) {
    const part = recordValue(candidate);
    if (!part) continue;
    if (part.type === 'text' && typeof part.text === 'string') {
      const result = parseUserText(part.text, Array.isArray(part.text_elements) && part.text_elements.length > 0);
      primary.push(result.primaryText);
      blocks.push(...result.blocks);
      continue;
    }
    const media = mediaBlockFromUserPart(part);
    if (media) {
      blocks.push(media);
      continue;
    }
    if (part.type === 'skill' || part.type === 'mention') {
      const kind = part.type === 'skill' ? 'SKILL' : 'MENTION';
      blocks.push(contextBlock(kind, { title: stringValue(part.name), text: stringValue(part.text) }));
    }
  }
  const text = bounded(primary.filter(Boolean).join('\n'));
  if (!text && !blocks.length) return null;
  return {
    messageId: parsed.data.id ?? null,
    role: 'USER',
    text,
    searchText: blockSearchText(blocks),
    phase: null,
    blocks,
  };
}

function parseDirectiveAttributes(source: string) {
  const attributes: Record<string, string> = {};
  let offset = 0;
  while (offset < source.length && Object.keys(attributes).length < 64) {
    while (/\s/u.test(source[offset] ?? '')) offset += 1;
    const keyMatch = /^[\w-]+/u.exec(source.slice(offset));
    if (!keyMatch) break;
    const key = keyMatch[0];
    offset += key.length;
    while (/\s/u.test(source[offset] ?? '')) offset += 1;
    if (source[offset] !== '=') break;
    offset += 1;
    while (/\s/u.test(source[offset] ?? '')) offset += 1;
    const quote = source[offset] === '"' || source[offset] === "'" ? source[offset++] : '';
    let result = '';
    while (offset < source.length) {
      const character = source[offset++];
      if (quote && character === '\\' && offset < source.length) {
        const escaped = source[offset++];
        result +=
          escaped === 'n'
            ? '\n'
            : escaped === 'r'
              ? '\r'
              : escaped === 't'
                ? '\t'
                : escaped === quote || escaped === '\\'
                  ? escaped
                  : `\\${escaped}`;
      } else if ((quote && character === quote) || (!quote && /\s/u.test(character))) break;
      else result += character;
    }
    attributes[key.slice(0, 200)] = result.slice(0, 32_768);
  }
  if (!Object.keys(attributes).length && source.trim()) attributes.value = bounded(source, 32_768);
  return attributes;
}

type DirectiveSegment =
  { type: 'TEXT'; value: string } | { type: 'DIRECTIVE'; name: string; attributes: Record<string, string> };

function inlineDirectiveSegments(line: string): DirectiveSegment[] | null {
  const segments: DirectiveSegment[] = [];
  let offset = 0;
  let textStart = 0;
  while (offset < line.length) {
    if (line[offset] === '`') {
      const ticks = /^`+/u.exec(line.slice(offset))?.[0] ?? '`';
      const closing = line.indexOf(ticks, offset + ticks.length);
      offset = closing < 0 ? line.length : closing + ticks.length;
      continue;
    }
    if (line[offset] !== ':') {
      offset += 1;
      continue;
    }
    const nameStart = line[offset + 1] === ':' ? offset + 2 : offset + 1;
    if (!/[a-z]/iu.test(line[nameStart] ?? '')) {
      offset += 1;
      continue;
    }
    const directive = /^:{1,2}([a-z][a-z0-9-]*)\{/iu.exec(line.slice(offset));
    if (!directive) {
      offset += 1;
      continue;
    }
    let cursor = offset + directive[0].length;
    let quote = '';
    let escaped = false;
    for (; cursor < line.length; cursor += 1) {
      const character = line[cursor] ?? '';
      if (escaped) {
        escaped = false;
        continue;
      }
      if (quote && character === '\\') {
        escaped = true;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = quote === character ? '' : quote || character;
        continue;
      }
      if (!quote && character === '}') break;
    }
    if (cursor >= line.length) {
      offset += directive[0].length;
      continue;
    }
    if (offset > textStart) segments.push({ type: 'TEXT', value: line.slice(textStart, offset) });
    segments.push({
      type: 'DIRECTIVE',
      name: directive[1] ?? 'directive',
      attributes: parseDirectiveAttributes(line.slice(offset + directive[0].length, cursor)),
    });
    offset = cursor + 1;
    textStart = offset;
  }
  if (!segments.length) return null;
  if (textStart < line.length) segments.push({ type: 'TEXT', value: line.slice(textStart) });
  return segments;
}

function splitAssistantBlocks(value: string) {
  const blocks: CodexHistoryMessageBlock[] = [];
  const markdown: string[] = [];
  const lines = value.split(/\r?\n/u);
  let fence = '';
  const flush = () => {
    const block = markdownBlock(markdown.join('\n'));
    if (block) blocks.push(block);
    markdown.length = 0;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const fenceMatch = /^\s*(`{3,}|~{3,})/u.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]?.[0] ?? '';
      fence = fence ? (fence === marker ? '' : fence) : marker;
      markdown.push(line);
      continue;
    }
    if (fence) {
      markdown.push(line);
      continue;
    }
    const writing = /^\s*:::writing(?:\{(.*)\})?\s*$/iu.exec(line);
    if (writing) {
      flush();
      const body: string[] = [];
      while (index + 1 < lines.length && lines[index + 1]?.trim() !== ':::') body.push(lines[++index] ?? '');
      if (lines[index + 1]?.trim() === ':::') index += 1;
      const attributes = parseDirectiveAttributes(writing[1] ?? '');
      blocks.push(
        contextBlock('WRITING', {
          title: attributes.title ?? '',
          text: body.join('\n'),
          items: Object.entries(attributes)
            .filter(([key]) => key !== 'title')
            .map(([label, text]) => ({ label, text, role: null, reference: null })),
        }),
      );
      continue;
    }
    const inline = inlineDirectiveSegments(line);
    if (inline) {
      for (const segment of inline) {
        if (segment.type === 'TEXT') markdown.push(segment.value);
        else {
          flush();
          blocks.push({ type: 'DIRECTIVE', name: segment.name, attributes: segment.attributes });
        }
      }
      continue;
    }
    const directive = /^\s*:{1,2}([a-z][a-z0-9-]*)\s*$/iu.exec(line);
    if (directive) {
      flush();
      blocks.push({ type: 'DIRECTIVE', name: directive[1] ?? 'directive', attributes: {} });
    } else {
      markdown.push(line);
    }
  }
  flush();
  return blocks;
}

function blockSearchText(blocks: CodexHistoryMessageBlock[]) {
  return bounded(
    blocks
      .flatMap((block) => {
        if (block.type === 'MARKDOWN') return [visibleMarkdownText(block.text)];
        if (block.type === 'CONTEXT')
          return [
            block.title,
            block.text,
            block.reference ?? '',
            ...block.items.flatMap((item) => [item.label, item.text, item.reference ?? '']),
          ];
        if (block.type === 'MEDIA') return [block.alt, block.source ?? '', block.prompt, block.error ?? ''];
        return [block.name, ...Object.entries(block.attributes).flat()];
      })
      .filter(Boolean)
      .join('\n'),
  );
}

function parseAgentMessage(value: unknown, includeCommentary: boolean): ParsedCodexHistoryMessage | null {
  const parsed = projectedAgentMessageSchema.safeParse(value);
  if (!parsed.success) return null;
  const sourcePhase = parsed.data.phase;
  if (sourcePhase && sourcePhase !== 'final_answer' && sourcePhase !== 'commentary') return null;
  if (sourcePhase === 'commentary' && !includeCommentary) return null;
  const text = bounded(parsed.data.text);
  if (!text) return null;
  const blocks = splitAssistantBlocks(text);
  return {
    messageId: parsed.data.id ?? null,
    role: 'ASSISTANT',
    text,
    searchText: blockSearchText(blocks),
    phase: sourcePhase === 'commentary' ? 'COMMENTARY' : 'FINAL',
    blocks,
  };
}

function parsePlan(value: unknown): ParsedCodexHistoryMessage | null {
  const parsed = projectedPlanSchema.safeParse(value);
  if (!parsed.success) return null;
  const text = bounded(parsed.data.text);
  const block = markdownBlock(text);
  if (!block) return null;
  return {
    messageId: parsed.data.id ?? null,
    role: 'ASSISTANT',
    text,
    searchText: blockSearchText([block]),
    phase: 'PLAN',
    blocks: [block],
  };
}

function imageStatus(value: unknown): 'GENERATING' | 'COMPLETED' | 'FAILED' {
  if (value === 'completed') return 'COMPLETED';
  if (value === 'failed') return 'FAILED';
  return 'GENERATING';
}

function parseImageGeneration(value: unknown): ParsedCodexHistoryMessage | null {
  const parsed = projectedImageGenerationSchema.safeParse(value);
  if (!parsed.success) return null;
  const prompt = bounded(stringValue(parsed.data.revisedPrompt));
  const failure = bounded(displayValue(parsed.data.failure));
  const source = bounded(stringValue(parsed.data.savedPath), 32_768);
  const status = imageStatus(parsed.data.status);
  const block: CodexHistoryMessageBlock = {
    type: 'MEDIA',
    kind: 'GENERATED_IMAGE',
    source: source || null,
    mediaUrl: source ? localMediaUrl(source) : null,
    alt: '',
    status,
    prompt,
    error: failure || null,
  };
  return {
    messageId: parsed.data.id ?? null,
    role: 'ASSISTANT',
    text: prompt || failure || status,
    searchText: blockSearchText([block]),
    phase: 'RESULT',
    blocks: [block],
  };
}

export function codexUserRequestText(value: string) {
  return bounded(splitUserEnvelope(value).request);
}

export function parseProjectedCodexHistoryValue(
  itemType: CodexHistoryProjectedItemType,
  value: unknown,
  includeCommentary = false,
): ParsedCodexHistoryMessage | null {
  if (itemType === 'userMessage') return parseUserMessage(value);
  if (itemType === 'agentMessage') return parseAgentMessage(value, includeCommentary);
  if (itemType === 'plan') return parsePlan(value);
  return parseImageGeneration(value);
}

export function parseProjectedCodexHistoryItem(
  itemType: CodexHistoryProjectedItemType,
  itemJson: string,
  includeCommentary = false,
) {
  let value: unknown;
  try {
    value = JSON.parse(itemJson);
  } catch {
    return null;
  }
  return parseProjectedCodexHistoryValue(itemType, value, includeCommentary);
}

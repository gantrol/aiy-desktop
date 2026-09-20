import type { CanvasPresetDto, DerivedVisualPromptTemplatesDto, DerivedVisualRole } from '@/shared/contracts';
import { contentMarkdownText } from '@/shared/content-markdown';

function normalizedContext(value: string) {
  return contentMarkdownText(value.replace(/\r\n?/gu, '\n').replaceAll('&#x20;', ' '), () => '');
}

function clipped(value: string, limit: number) {
  const normalized = normalizedContext(value);
  if (normalized.length <= limit) return normalized;
  const tailLength = Math.min(4_000, Math.floor(limit / 4));
  return `${normalized.slice(0, limit - tailLength - 5).trimEnd()}\n…\n${normalized.slice(-tailLength).trimStart()}`;
}

function fill(template: string, values: Record<string, string>) {
  if (!template.trim()) throw new Error('Derived visual prompts are unavailable');
  let result = template;
  for (const [token, value] of Object.entries(values)) result = result.split(`{${token}}`).join(value);
  if (result.length > 30_000) throw new Error('The generated image prompt is too long');
  return result;
}

function compositionConstraint(
  templates: DerivedVisualPromptTemplatesDto,
  role: DerivedVisualRole,
  preset: CanvasPresetDto,
) {
  const constraint = templates.compositionConstraints[`${role}:${preset.stableKey}`];
  if (!constraint) throw new Error('The selected canvas has no composition rule for this visual');
  return constraint;
}

export function buildArticleHeaderPrompt(
  templates: DerivedVisualPromptTemplatesDto,
  title: string,
  markdown: string,
  preset: CanvasPresetDto,
) {
  return fill(templates.articleHeader, {
    题目: title.trim(),
    正文: clipped(markdown, 6_000),
    比例: preset.ratio,
    宽度: String(preset.width),
    高度: String(preset.height),
    对应画幅的构图约束: templates.compositionConstraints[`ARTICLE_HEADER:${preset.stableKey}`] ?? '',
  });
}

export function buildArticleInlinePrompt(
  templates: DerivedVisualPromptTemplatesDto,
  preset: CanvasPresetDto,
  title: string,
  selectedText: string,
  markdown: string,
) {
  return fill(templates.articleInline, {
    比例: preset.ratio,
    宽度: String(preset.width),
    高度: String(preset.height),
    对应画幅的构图约束: compositionConstraint(templates, 'ARTICLE_INLINE', preset),
    题目: title.trim() || '未命名图文',
    段落: clipped(selectedText, 5_000),
    正文: clipped(markdown, 18_000),
  });
}

export function buildSocialCoverPrompt(
  templates: DerivedVisualPromptTemplatesDto,
  preset: CanvasPresetDto,
  title: string,
  body: string,
) {
  return fill(templates.socialCover, {
    比例: preset.ratio,
    宽度: String(preset.width),
    高度: String(preset.height),
    对应画幅的构图约束: compositionConstraint(templates, 'SOCIAL_POST_COVER', preset),
    题目: title.trim() || '未命名图文',
    正文: clipped(body, 9_000),
  });
}

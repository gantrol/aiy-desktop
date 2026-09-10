import type { ComposerAdapter, ComposerElement } from '@/lib/composer-adapters/contract';
import {
  composerElements,
  hasEditorHint,
  normalizeControlLabel,
  requestMediaInputWithin,
  usableMediaInputs,
} from '@/lib/composer-adapters/dom';

const WEIBO_PUBLISH_LABELS = new Set(['发布', '发微博']);
const WEIBO_COMPOSER_HINT = '有什么新鲜事';

function scopeHasWeiboHint(scope: HTMLElement): boolean {
  if (hasEditorHint(scope, WEIBO_COMPOSER_HINT)) return true;
  const text = normalizeControlLabel(scope.textContent ?? '');
  return scope.childElementCount <= 4 && text.includes(WEIBO_COMPOSER_HINT);
}

function scopeHasWeiboPublishControl(scope: HTMLElement): boolean {
  const controls = scope.querySelectorAll<HTMLElement>('button,[role="button"],[tabindex]');
  return [...controls].some((control) =>
    WEIBO_PUBLISH_LABELS.has(normalizeControlLabel(control.innerText || control.textContent || '')),
  );
}

function weiboCandidateScore(editor: ComposerElement): number {
  let score = 0;
  if (editor.getAttribute('role') === 'textbox') score += 12;
  if (editor instanceof HTMLTextAreaElement || editor.isContentEditable) score += 8;

  const bounds = editor.getBoundingClientRect();
  if (bounds.width >= 240 && bounds.height >= 36) score += 5;
  if (hasEditorHint(editor, WEIBO_COMPOSER_HINT)) score += 120;

  let hintFound = false;
  let publishFound = false;
  let scope: HTMLElement | null = editor.parentElement;
  for (let depth = 1; scope && depth <= 10; depth += 1, scope = scope.parentElement) {
    if (!hintFound && scopeHasWeiboHint(scope)) {
      score += Math.max(70 - depth * 4, 30);
      hintFound = true;
    }
    if (!publishFound && scopeHasWeiboPublishControl(scope)) {
      score += Math.max(35 - depth * 3, 8);
      publishFound = true;
    }
    if (hintFound && publishFound) break;
  }

  return score;
}

export const weiboComposerAdapter: ComposerAdapter = {
  findEditors() {
    const scored = composerElements()
      .map((element) => ({ element, score: weiboCandidateScore(element) }))
      .filter(({ score }) => score >= 28)
      .sort((left, right) => right.score - left.score);
    return scored.filter(({ score }) => score === scored[0]?.score).map(({ element }) => element);
  },
  findMediaInput(editor) {
    let scope = editor.parentElement;
    for (let depth = 0; scope && depth < 12; depth += 1, scope = scope.parentElement) {
      const input = usableMediaInputs(scope)[0];
      if (input) return input;
    }
    return usableMediaInputs(document)[0] ?? null;
  },
  requestMediaInput(editor) {
    let scope = editor.parentElement;
    for (let depth = 0; scope && depth < 12; depth += 1, scope = scope.parentElement) {
      if (requestMediaInputWithin(scope)) return;
    }
    requestMediaInputWithin(document);
  },
};

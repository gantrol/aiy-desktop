import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { testMessages } from './support/i18n';

const rendererRoot = path.resolve(__dirname, '../src/renderer/components/dictionary');
const classificationRoot = path.join(rendererRoot, 'classifications');

function source(filePath: string) {
  return readFileSync(filePath, 'utf8');
}

describe('dictionary classification localization contract', () => {
  it('loads classification copy from the Chinese language pack, including parameterized messages', () => {
    const copy = testMessages.zh.dictionary.classifications;

    expect(copy.inspector.currentOnly).toBe('仅当前层');
    expect(copy.inspector.imagesManagedInTerms).toBe('代表图片在各词条中维护。');
    expect(copy.inspector.showing(12, 30)).toBe('显示前 12 个，共 30 个');
    expect(copy.dialogs.moveTitle('连衣裙')).toBe('移动“连衣裙”');
    expect(copy.tree.moreActionsFor('连衣裙')).toBe('连衣裙的更多操作');
  });

  it('keeps dictionary maintenance UI free of inline Chinese-English selectors', () => {
    const classificationSources = readdirSync(classificationRoot)
      .filter((fileName) => fileName.endsWith('.ts') || fileName.endsWith('.tsx'))
      .map((fileName) => source(path.join(classificationRoot, fileName)))
      .join('\n');
    const termSources = ['TermEditor.tsx', 'TermDetailView.tsx', 'NewTermDialog.tsx']
      .map((fileName) => source(path.join(rendererRoot, fileName)))
      .join('\n');
    const dictionaryScreenSource = source(path.resolve(rendererRoot, '../DictionaryScreen.tsx'));

    for (const combinedSource of [classificationSources, termSources, dictionaryScreenSource]) {
      expect(combinedSource).not.toMatch(/\blabel\(\s*['"`]/);
      expect(combinedSource).not.toMatch(/locale\s*===\s*['"]zh['"]\s*\?\s*['"`]/);
    }
  });
});

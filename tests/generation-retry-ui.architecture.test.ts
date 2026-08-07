import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { testMessages } from './support/i18n';

const rendererRoot = path.resolve(__dirname, '../src/renderer');
const read = (relativePath: string) => readFileSync(path.join(rendererRoot, relativePath), 'utf8');

describe('generation retry UI semantics', () => {
  it('does not claim an interrupted provider request can continue', () => {
    expect(testMessages.zh.app.generationStatus.regenerate).toBe('重新生成');
    expect(testMessages.en.app.generationStatus.regenerate).toBe('Regenerate');
    expect(testMessages.zh.creator.generationTasks.regenerate).toBe('重新生成');
    expect(testMessages.en.creator.generationTasks.regenerate).toBe('Regenerate');

    const sources = [
      read('components/app/GenerationStatusPopover.tsx'),
      read('components/creator/GenerationTaskTray.tsx'),
      read('components/creator/GenerationComparison.tsx'),
    ].join('\n');
    expect(sources).not.toContain('generationStatus.continue');
    expect(sources).not.toContain('generationTasks.continue');
    expect(sources).not.toContain('l.continue');
  });

  it('retries the failed run instead of starting an unrelated generation', () => {
    const comparison = read('components/creator/GenerationComparison.tsx');
    expect(comparison).toContain('await onRetry(run.id);');
    expect(comparison).toContain('onRetry={() => void retry(row, failure)}');
    expect(comparison).toContain('onRetry={() => void retry(row, run)}');
    expect(comparison).not.toContain('onRetry={() => void generate(');

    expect(read('components/creator/OutputInspector.tsx')).toContain('onRetry={onRetryGeneration}');
    expect(read('components/CreatorScreen.tsx')).toContain('onRetryGeneration={retryGeneration}');
  });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  dictionaryMutationError,
  runDictionaryMutation,
} from '../src/renderer/components/dictionary/dictionary-mutation';

const root = path.resolve(__dirname, '..');
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8');

describe('dictionary write boundary', () => {
  it('carries the active locale through renderer, typed preload, and IPC validation', () => {
    const contracts = read('src/shared/contracts.ts');
    const screen = read('src/renderer/components/DictionaryScreen.tsx');
    const ipc = read('src/main/ipc.ts');

    expect(contracts).toContain('export interface DictionarySaveDraftInput');
    expect(contracts).toContain('dictionarySaveDraft(input: DictionarySaveDraftInput)');
    expect(screen.match(/dictionarySaveDraft\(\{ draft, locale \}\)/g)).toHaveLength(2);
    expect(ipc).toContain('const dictionarySaveDraftSchema = z.object({');
    expect(ipc).toContain('locale: localeSchema');
    expect(ipc).toContain('database.saveTermDraft(input.draft, input.locale)');
    expect(ipc).not.toContain("database.saveTermDraft(input, 'zh')");
  });

  it('reports a rejected write and always restores pending state', async () => {
    const pending: boolean[] = [];
    const notify = vi.fn();
    const onSuccess = vi.fn();

    const succeeded = await runDictionaryMutation({
      setPending: (value) => pending.push(value),
      mutate: async () => {
        throw new Error('write failed');
      },
      onSuccess,
      notify,
      fallbackError: 'Operation failed',
    });

    expect(succeeded).toBe(false);
    expect(pending).toEqual([true, false]);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('write failed');
  });

  it('uses a real fallback status for non-descriptive failures', () => {
    expect(dictionaryMutationError(undefined, 'Operation failed')).toBe('Operation failed');
  });
});

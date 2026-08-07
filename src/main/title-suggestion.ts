import type { CodexTitleInput, CodexTitleResult } from '@/shared/contracts';
interface RawTitleSuggestion {
  title: string;
}

export function titleSuggestionTask(input: CodexTitleInput) {
  const hasSuppliedTitle = Boolean(input.title.trim());
  return input.mode === 'fill' && hasSuppliedTitle
    ? 'Keep the supplied title exactly as written and return it in title.'
    : 'Create one fresh, concise Chinese title in title from the visual prompt.';
}

export function titleSuggestionPayload(input: CodexTitleInput) {
  return {
    prompt: input.prompt.slice(0, 12_000),
    title: input.title.trim().slice(0, 300),
  };
}

export function normalizeTitleSuggestion(
  input: CodexTitleInput,
  result: RawTitleSuggestion,
  providerName: string,
): CodexTitleResult {
  const title = result.title.replace(/\s+/g, ' ').trim();
  if (!title) throw new Error(`${providerName} returned an empty title`);
  if (!(input.mode === 'fill' && input.title.trim()) && !/\p{Script=Han}/u.test(title)) {
    throw new Error(`${providerName} returned a non-Chinese title`);
  }
  return { title: title.slice(0, 300) };
}

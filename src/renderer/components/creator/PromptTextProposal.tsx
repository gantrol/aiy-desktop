import { ArrowRightIcon, CheckIcon, FilePenLineIcon, LoaderCircleIcon } from 'lucide-react';
import type { AssistantProposalApplyValue, PromptEditProposalDto } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';

export interface PromptTextProposalCopy {
  promptChanges: string;
  preserved: string;
  removed: string;
  before: string;
  after: string;
  applyChange: string;
  removeItem: string;
  changeApplied: string;
  promptProposal: string;
  proposalApplied: string;
}

interface Props {
  prompt: string;
  promptEdit?: PromptEditProposalDto;
  optimizedPrompt: string;
  showOptimizedPrompt: boolean;
  proposalApplied: boolean;
  stale: boolean;
  applying: boolean;
  copy: PromptTextProposalCopy;
  onApply(value: AssistantProposalApplyValue): boolean | void | Promise<boolean | void>;
}

function isWhitespace(character: string) {
  return character.trim().length === 0;
}

function collapseRepeatedCommas(value: string) {
  const result: string[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    if (value[cursor] !== ',') {
      result.push(value[cursor]);
      cursor += 1;
      continue;
    }
    let end = cursor + 1;
    let commaCount = 1;
    while (end < value.length) {
      let nextComma = end;
      while (nextComma < value.length && isWhitespace(value[nextComma])) nextComma += 1;
      if (value[nextComma] !== ',') break;
      commaCount += 1;
      end = nextComma + 1;
    }
    if (commaCount > 1) {
      result.push(', ');
      cursor = end;
      continue;
    }
    result.push(',');
    cursor += 1;
  }
  return result.join('');
}

function trimEdgeComma(value: string) {
  let start = 0;
  let end = value.length;
  while (start < end && isWhitespace(value[start])) start += 1;
  if (value[start] === ',') {
    start += 1;
    while (start < end && isWhitespace(value[start])) start += 1;
  }
  while (end > start && isWhitespace(value[end - 1])) end -= 1;
  if (value[end - 1] === ',') {
    end -= 1;
    while (end > start && isWhitespace(value[end - 1])) end -= 1;
  }
  return value.slice(start, end);
}

function normalizeEditedPrompt(value: string) {
  return trimEdgeComma(collapseRepeatedCommas(value))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function PromptTextProposal({
  prompt,
  promptEdit,
  optimizedPrompt,
  showOptimizedPrompt,
  proposalApplied,
  stale,
  applying,
  copy,
  onApply,
}: Props) {
  function applyStructuredChange(before: string, after: string) {
    if (!before) {
      if (after && !prompt.includes(after)) {
        void onApply({ kind: 'PROMPT_TEXT', prompt: normalizeEditedPrompt(`${prompt}\n${after}`) });
      }
      return;
    }
    const index = prompt.indexOf(before);
    if (index < 0) return;
    void onApply({
      kind: 'PROMPT_TEXT',
      prompt: normalizeEditedPrompt(`${prompt.slice(0, index)}${after}${prompt.slice(index + before.length)}`),
    });
  }

  function applyStructuredRemoval(fragment: string) {
    const index = prompt.indexOf(fragment);
    if (index < 0) return;
    void onApply({
      kind: 'PROMPT_TEXT',
      prompt: normalizeEditedPrompt(`${prompt.slice(0, index)}${prompt.slice(index + fragment.length)}`),
    });
  }

  return (
    <>
      {promptEdit && (
        <article data-prompt-edit-proposal className="rounded-lg border bg-background p-3">
          <div className="flex items-center gap-2">
            <FilePenLineIcon className="size-4 text-muted-foreground" />
            <strong className="text-xs">{copy.promptChanges}</strong>
          </div>
          {promptEdit.summary && (
            <p className="mt-2 text-xs leading-relaxed text-foreground-secondary">{promptEdit.summary}</p>
          )}
          {promptEdit.preserved.length > 0 && (
            <div className="mt-3">
              <span className="text-2xs font-medium text-muted-foreground">{copy.preserved}</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {promptEdit.preserved.map((item, index) => (
                  <span
                    key={`${item}:${index}`}
                    className="rounded-sm bg-success-surface px-1.5 py-0.5 text-2xs text-success"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          )}
          {promptEdit.changes.length > 0 && (
            <div className="mt-3 space-y-2">
              {promptEdit.changes.map((change, index) => {
                const applied = Boolean(
                  change.after && prompt.includes(change.after) && (!change.before || !prompt.includes(change.before)),
                );
                const canApply = change.before
                  ? prompt.includes(change.before)
                  : Boolean(change.after && !prompt.includes(change.after));
                return (
                  <div
                    key={`${change.before}:${index}`}
                    className="grid gap-1 rounded-md bg-surface-sunken p-2 text-xs md:grid-cols-2"
                  >
                    <div>
                      <span className="text-2xs text-muted-foreground">{copy.before}</span>
                      <p className="mt-0.5 line-through decoration-destructive/60">{change.before}</p>
                    </div>
                    <div>
                      <span className="text-2xs text-muted-foreground">{copy.after}</span>
                      <p className="mt-0.5 font-medium">{change.after}</p>
                    </div>
                    <div className="flex items-center justify-between gap-2 md:col-span-2">
                      <p className="text-2xs text-muted-foreground">{change.reason}</p>
                      {applied ? (
                        <span className="inline-flex items-center gap-1 text-2xs font-medium text-success">
                          <CheckIcon className="size-3" />
                          {copy.changeApplied}
                        </span>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          disabled={stale || applying || !canApply}
                          onClick={() => applyStructuredChange(change.before, change.after)}
                        >
                          {copy.applyChange}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {promptEdit.removed.length > 0 && (
            <div className="mt-3">
              <span className="text-2xs font-medium text-muted-foreground">{copy.removed}</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {promptEdit.removed.map((item, index) => {
                  const applied = !prompt.includes(item);
                  return (
                    <span
                      key={`${item}:${index}`}
                      className="inline-flex items-center gap-1 rounded-sm bg-destructive-surface px-1.5 py-0.5 text-2xs text-destructive"
                    >
                      <span className="line-through">{item}</span>
                      {applied ? (
                        <CheckIcon className="size-3 text-success" />
                      ) : (
                        <button
                          type="button"
                          className="font-medium underline-offset-2 hover:underline disabled:no-underline disabled:opacity-50"
                          disabled={stale || applying}
                          onClick={() => applyStructuredRemoval(item)}
                        >
                          {copy.removeItem}
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </article>
      )}

      {showOptimizedPrompt && (
        <article data-prompt-text-proposal className="rounded-lg border bg-background p-3">
          <div className="flex items-center justify-between gap-3">
            <strong className="text-xs">{copy.promptProposal}</strong>
            {proposalApplied && !stale ? (
              <span className="flex items-center gap-1 text-xs text-success">
                <CheckIcon className="size-3.5" />
                {copy.proposalApplied}
              </span>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="xs"
                disabled={stale || applying}
                onClick={() => void onApply({ kind: 'PROMPT_TEXT', prompt: optimizedPrompt })}
              >
                {applying ? (
                  <LoaderCircleIcon className="size-3.5 animate-spin" />
                ) : (
                  <ArrowRightIcon className="size-3.5" />
                )}
                {copy.applyChange}
              </Button>
            )}
          </div>
          <p className="mt-2 line-clamp-4 font-mono text-xs leading-relaxed text-foreground-secondary">
            {optimizedPrompt}
          </p>
        </article>
      )}
    </>
  );
}

import { useRef, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { useI18n } from '@/renderer/i18n/useI18n';
import { moveWorkCell } from '@/renderer/features/work-tracking/WorkTableEditing';

export function WorkTextCell({
  value,
  display,
  label,
  version,
  disabled,
  maxLength,
  onSave,
  onOpen,
}: {
  value: string;
  display: string;
  label: string;
  version: string | number;
  disabled: boolean;
  maxLength: number;
  onSave(value: string, version: string | number): Promise<string | null>;
  onOpen?(): void;
}) {
  const l = useI18n().messages.workTracking;
  const [draft, setDraft] = useState<{ value: string; version: string | number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const composing = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const begin = () => {
    setError(null);
    setDraft({ value, version });
  };
  const cancel = () => {
    if (!pending.current) {
      setDraft(null);
      setError(null);
      requestAnimationFrame(() => trigger.current?.focus());
    }
  };
  const save = async (direction = 0) => {
    if (!draft || pending.current || composing.current) return;
    const focus = trigger.current ? moveWorkCell(trigger.current, direction) : () => undefined;
    pending.current = true;
    setSaving(true);
    const failure =
      draft.value === value ? null : await onSave(draft.value, draft.version).catch(() => l.errors.storageUnavailable);
    pending.current = false;
    setSaving(false);
    setError(failure);
    if (failure) input.current?.focus();
    else {
      setDraft(null);
      focus();
    }
  };
  return (
    <div className="grid min-w-0 gap-1">
      <Button
        ref={trigger}
        data-work-cell
        tabIndex={draft ? -1 : undefined}
        variant="ghost"
        size="sm"
        disabled={disabled && !draft}
        className={
          draft
            ? 'sr-only'
            : 'min-h-8 h-auto w-full min-w-0 justify-start whitespace-normal break-words px-0 text-left text-sm font-normal hover:bg-hover-strong focus-visible:ring-inset focus-visible:ring-offset-0'
        }
        aria-label={`${label}: ${display}`}
        title={onOpen ? l.renameHint : label}
        onClick={onOpen ?? begin}
        onDoubleClick={onOpen ? begin : undefined}
        onKeyDown={(event) => {
          if (event.key === 'F2') {
            event.preventDefault();
            begin();
          }
        }}
      >
        {display}
      </Button>
      {draft && (
        <>
          <Input
            ref={input}
            autoFocus
            aria-label={label}
            value={draft.value}
            maxLength={maxLength}
            readOnly={saving}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDraft({ ...draft, value: event.target.value })}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
              if (event.key === 'Escape') {
                event.preventDefault();
                cancel();
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault();
                void save(event.key === 'Tab' ? (event.shiftKey ? -1 : 1) : 0);
              }
            }}
          />
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => void save()}>
              {l.save}
            </Button>
            <Button size="sm" variant="ghost" disabled={saving} onClick={cancel}>
              {l.cancel}
            </Button>
          </div>
          {error && (
            <span role="alert" className="max-w-64 whitespace-normal text-xs text-destructive">
              {error}
            </span>
          )}
        </>
      )}
    </div>
  );
}

import type { ComponentProps } from 'react';
import { Input } from '@/renderer/components/ui/input';
import type { NoteEditSession } from '@/renderer/features/desktop-petals/note-edit-session';
import { useI18n } from '@/renderer/i18n/useI18n';

export function NoteTitleInput({
  session,
  state,
  compact = false,
  readOnly = false,
}: {
  session: NoteEditSession;
  state: ReturnType<NoteEditSession['getSnapshot']>;
  compact?: boolean;
  readOnly?: boolean;
}) {
  return (
    <NoteTitleField
      compact={compact}
      readOnly={readOnly}
      value={state.title}
      onChange={(event) => session.edit(session.getSnapshot().text, { title: event.target.value })}
      onCompositionStart={() => session.setComposing(true)}
      onCompositionEnd={(event) => {
        session.edit(session.getSnapshot().text, { title: event.currentTarget.value });
        session.setComposing(false);
      }}
      onBlur={() => void session.flush()}
    />
  );
}

export function NoteTitleField({ compact = false, ...props }: ComponentProps<typeof Input> & { compact?: boolean }) {
  const copy = useI18n().messages.desktopPetals.document;
  return (
    <Input
      aria-label={copy.title}
      placeholder={copy.title}
      maxLength={200}
      className={
        compact
          ? 'h-8 shrink-0 rounded-none border-0 bg-transparent pl-6 pr-3 text-[15px] font-medium text-inherit shadow-none placeholder:text-current/35 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-offset-0'
          : 'mb-3 border-0 px-3 text-lg font-medium shadow-none'
      }
      {...props}
    />
  );
}

import type { ComponentProps } from 'react';
import { Input } from '@/renderer/components/ui/input';
import type { NoteEditSession } from '@/renderer/features/desktop-petals/note-edit-session';
import { useI18n } from '@/renderer/i18n/useI18n';
import { articleTitleClassName } from '@/renderer/lib/articleTypography';

export function NoteTitleInput({
  session,
  state,
  compact = false,
  document = false,
  readOnly = false,
}: {
  session: NoteEditSession;
  state: ReturnType<NoteEditSession['getSnapshot']>;
  compact?: boolean;
  document?: boolean;
  readOnly?: boolean;
}) {
  return (
    <NoteTitleField
      compact={compact}
      document={document}
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

export function NoteTitleField({
  compact = false,
  document = false,
  ...props
}: ComponentProps<typeof Input> & { compact?: boolean; document?: boolean }) {
  const copy = useI18n().messages.desktopPetals.document;
  return (
    <Input
      aria-label={copy.title}
      placeholder={copy.title}
      maxLength={200}
      className={
        compact
          ? 'h-8 shrink-0 rounded-none border-0 bg-transparent pl-6 pr-3 text-[15px] font-medium text-inherit shadow-none placeholder:text-current/35 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-offset-0'
          : document
            ? `${articleTitleClassName} h-auto min-w-0 flex-1 border-0 px-0 shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`
            : 'mb-3 border-0 px-3 text-lg font-medium shadow-none'
      }
      {...props}
    />
  );
}

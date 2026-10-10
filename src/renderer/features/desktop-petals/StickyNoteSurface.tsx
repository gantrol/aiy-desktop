import type { ComponentProps, HTMLAttributes, ReactNode } from 'react';
import { LockKeyhole } from 'lucide-react';
import { noteAppearanceStyle, PetalNoteIcon } from '@/renderer/features/desktop-petals/petal-appearance';
import type { PetalColor, PetalIcon } from '@/shared/contracts/desktop-petals';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import '@/renderer/features/desktop-petals/StickyNote.css';

/** Shared paper and window chrome; the host supplies its editor and actions. */
export function StickyNoteSurface({
  color,
  icon,
  editable = true,
  libraryName,
  closing = false,
  animate = true,
  nativeDrag = true,
  headerDrag,
  fullWindow = false,
  appearance,
  actions,
  className,
  style,
  children,
  ...props
}: Omit<ComponentProps<'section'>, 'color'> & {
  color: PetalColor;
  icon: PetalIcon;
  editable?: boolean;
  libraryName?: string;
  closing?: boolean;
  animate?: boolean;
  nativeDrag?: boolean;
  headerDrag?: HTMLAttributes<HTMLElement>;
  fullWindow?: boolean;
  appearance?: ReactNode;
  actions: ReactNode;
}) {
  const copy = useI18n().messages.desktopPetals;
  return (
    <section
      className={cn(
        'sticky-note absolute inset-2 flex flex-col overflow-hidden rounded-md bg-[var(--petal-surface)] text-[var(--petal-ink)]',
        closing && 'note-closing',
        className,
      )}
      style={{ ...noteAppearanceStyle(color), ...(animate ? undefined : { animation: 'none' }), ...style }}
      aria-label={libraryName ? `${copy.note.title} · ${libraryName}` : copy.note.title}
      {...props}
    >
      <header
        hidden={fullWindow}
        className={cn(
          'flex shrink-0 cursor-move items-center gap-0.5 px-3 py-1.5 select-none [&_svg]:size-3.5',
          fullWindow && 'hidden',
          nativeDrag ? '[-webkit-app-region:drag]' : '[-webkit-app-region:no-drag]',
          headerDrag && 'touch-none',
        )}
        {...headerDrag}
      >
        {appearance ?? <PetalNoteIcon icon={icon} className="shrink-0 opacity-60" />}
        <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[11px] opacity-60">
          <span className="truncate" title={libraryName ? `${copy.scope.current} · ${libraryName}` : undefined}>
            {libraryName ? copy.scope.note : copy.note.title}
            {libraryName ? ` · ${libraryName}` : ''}
          </span>
          {!editable && (
            <span title={copy.note.structured} role="img" aria-label={copy.note.structured}>
              <LockKeyhole />
            </span>
          )}
        </span>
        {actions}
      </header>
      {fullWindow && (
        <div
          className={cn(
            'h-3 shrink-0 cursor-move touch-none',
            nativeDrag ? '[-webkit-app-region:drag]' : '[-webkit-app-region:no-drag]',
          )}
          title={copy.controls.drag}
          {...headerDrag}
        />
      )}
      {children}
    </section>
  );
}

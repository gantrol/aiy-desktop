import { useCallback, useState } from 'react';
import { PetalLoadError } from '@/renderer/features/desktop-petals/PetalLoadError';
import { CollapsedPetal } from '@/renderer/features/desktop-petals/CollapsedPetal';
import { useI18n } from '@/renderer/i18n/useI18n';
import { CodexNoteProvider } from '@/renderer/features/extensions/codex-content/CodexNoteContext';
import { useCodexAgentSignal } from '@/renderer/features/extensions/codex-content/CodexAgentLight';
import { useNoteViewPreference } from '@/renderer/features/desktop-petals/use-note-view-preference';
import { CODEX_CONTENT_APPLICATION_ID } from '@/shared/contracts/content-applications';
import type { DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';
import type { PetalNoteSummary } from '@/shared/contracts/petal-note-summary';

export function CollapsedNote({ note, snapshot }: { note: PetalNoteSummary; snapshot: DesktopPetalSnapshot }) {
  const [visible] = useNoteViewPreference('applications', true);
  return (
    <CodexNoteProvider
      stashId={note.stashId}
      persisted={note.persisted}
      available={
        visible &&
        snapshot.contentApplications.some((item) => item.id === CODEX_CONTENT_APPLICATION_ID && item.available)
      }
    >
      <NoteSurface note={note} snapshot={snapshot} />
    </CodexNoteProvider>
  );
}

function NoteSurface({ note, snapshot }: { note: PetalNoteSummary; snapshot: DesktopPetalSnapshot }) {
  const copy = useI18n().messages.desktopPetals;
  const signal = useCodexAgentSignal();
  const [error, setError] = useState('');
  const onError = useCallback((reason: unknown) => setError(String(reason)), []);
  const title = note.title || (note.hasImages ? copy.board.IMAGE : copy.note.newTitle);
  return (
    <>
      <CollapsedPetal
        titlesVisible={snapshot.titlesVisible}
        color={note.color}
        icon={note.icon}
        label={copy.note.open.replace('{title}', title)}
        title={title}
        signal={signal}
        onOpen={() => void window.desktopPetals.expand(true).catch(onError)}
        onError={onError}
        menuPreview={snapshot.flowerPreview}
        menuActions={{
          note,
          home: snapshot.home,
          alwaysOnTop: snapshot.alwaysOnTop,
          board: snapshot.board,
          persisted: note.persisted,
          disabled: snapshot.suspended,
          onError,
          onExpand: () => window.desktopPetals.expand(true),
          onDuplicate: () =>
            window.desktopPetals.create({ requestId: crypto.randomUUID(), stashId: note.stashId, duplicate: true }),
          onAppearance: async (patch) => {
            await window.desktopPetals.appearance({ id: note.id, ...patch });
          },
        }}
      />
      {error && <PetalLoadError error={error} initial={false} onRetry={() => setError('')} />}
    </>
  );
}

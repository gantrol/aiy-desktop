import { useEffect, useRef, useState } from 'react';
import type { CreationDraftDto } from '@/shared/contracts';
import type { CreatorScreenViewModel } from '@/renderer/components/creator/screen/creatorScreenViewModel';
import {
  creationDraftSnapshotKey,
  savedCreationDraftSnapshot,
  type CreationDraftSaveSnapshot,
} from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import { Button } from '@/renderer/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { useI18n } from '@/renderer/i18n/useI18n';

function DraftPreview({ snapshot }: { snapshot: CreationDraftSaveSnapshot }) {
  const copy = useI18n().messages.creator.draftConflict;
  return (
    <div className="grid gap-2 py-2">
      <span className="truncate font-medium">{snapshot.title || copy.untitled}</span>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-sans">{snapshot.text}</pre>
      <span className="text-xs text-muted-foreground">
        {copy.materials
          .replace('{images}', String(snapshot.referenceAssetIds.length))
          .replace('{videos}', String(snapshot.videoMaterialIds?.length ?? 0))}
      </span>
    </div>
  );
}

/** Non-modal recovery stays with its editor; the other split remains usable. */
export function CreationDraftConflictStatus({ model }: { model: CreatorScreenViewModel }) {
  const copy = useI18n().messages.creator.draftConflict;
  const session = model.selection.creationDraftSession;
  const document = model.generation.promptDocument;
  const draftId = session.conflictDraftId;
  const [saved, setSaved] = useState<CreationDraftDto | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<'load' | 'copy' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setSaved(null);
    setExpanded(false);
    setError(null);
  }, [draftId]);

  async function resolve(action: 'compare' | 'load' | 'copy') {
    if (!draftId || busyRef.current) return;
    busyRef.current = true;
    setBusy(action === 'copy' ? 'copy' : 'load');
    setError(null);
    const identity = session.captureAutosaveIdentity();
    const isCurrent = () => {
      const current = session.captureAutosaveIdentity();
      return mounted.current && current.sessionGeneration === identity.sessionGeneration && current.draftId === draftId;
    };
    try {
      if (action === 'copy') {
        const copyDraft = await session.saveDraftCopy();
        if (mounted.current && session.getDraftId() === copyDraft.id)
          model.navigation.creation.continueSavedDraft(copyDraft);
        return;
      }
      await document.promptComposerRef.current?.whenSettled();
      if (!isCurrent()) return;
      const before = creationDraftSnapshotKey(model.draftInput.draftProjection.captureDraft());
      const remote = await window.desktopApi.creationDraftLoad({ draftId });
      if (!isCurrent()) return;
      setSaved(remote);
      setExpanded(true);
      if (action === 'compare') return;
      if (!saved || saved.updatedAt !== remote.updatedAt) {
        setError(copy.savedChanged);
        return;
      }
      if (
        document.promptComposerRef.current?.hasPendingInput() ||
        before !== creationDraftSnapshotKey(model.draftInput.draftProjection.captureDraft())
      ) {
        setError(copy.changed);
        return;
      }
      // Only this explicit replacement hydrates remote input. Saving a copy never overwrites the original.
      model.generation.hydration.restoreDraft(remote);
    } catch {
      if (isCurrent()) setError(copy.failed);
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  if (!draftId) return null;
  const current = model.draftInput.draftProjection.snapshotForPrompt({
    document: document.document,
    nodes: document.promptNodes,
    manualPrompt: document.manualPrompt,
    selectedTerms: document.selectedTerms,
    appliedPalettes: document.appliedPalettes,
  });
  return (
    <section className="grid shrink-0 gap-2 border-b bg-muted/40 px-4 py-3 text-sm" aria-label={copy.title}>
      <div role="status" className="font-medium">
        {error ?? (busy === 'copy' ? copy.saving : busy === 'load' ? copy.loading : copy.title)}
        <span className="ml-2 font-normal">{current.title || copy.untitled}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void resolve('compare')}>
          {copy.compare}
        </Button>
        <Button size="sm" disabled={Boolean(busy)} onClick={() => void resolve('copy')}>
          {copy.saveCopy}
        </Button>
        <Button size="sm" variant="outline" disabled={Boolean(busy) || !saved} onClick={() => void resolve('load')}>
          {copy.loadSaved}
        </Button>
      </div>
      {expanded && saved && (
        <Tabs defaultValue="current">
          <TabsList>
            <TabsTrigger value="current">{copy.current}</TabsTrigger>
            <TabsTrigger value="saved">{copy.saved}</TabsTrigger>
          </TabsList>
          <TabsContent value="current">
            <DraftPreview snapshot={current} />
          </TabsContent>
          <TabsContent value="saved">
            <DraftPreview snapshot={savedCreationDraftSnapshot(saved)} />
          </TabsContent>
        </Tabs>
      )}
    </section>
  );
}

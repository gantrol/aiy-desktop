import { useState, useSyncExternalStore } from 'react';
import type { CreatorInputRecoverySession } from '@/renderer/components/creator/workflows/CreatorInputRecoverySession';
import { creatorInputRecoveryRequests } from '@/renderer/components/creator/workflows/creatorInputRecoveryRequests';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { CreatorInputRecoverySnapshot } from '@/shared/contracts/creator-input-recovery';

function InputPreview({ snapshot }: { snapshot: CreatorInputRecoverySnapshot | null }) {
  const c = useI18n().messages.creator.inputRecovery;
  if (!snapshot) return <div className="py-3 text-sm text-muted-foreground">{c.originalVersion}</div>;
  return (
    <div className="space-y-3 py-3">
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-sans text-sm">
        {snapshot.manualPrompt || snapshot.resolvedPrompt || c.emptyPrompt}
      </pre>
      <div className="text-xs text-muted-foreground">
        {c.savedDetails
          .replace('{images}', String(snapshot.referenceAssetIds.length))
          .replace('{videos}', String(snapshot.videoMaterialIds?.length ?? snapshot.videoAttachments?.length ?? 0))
          .replace('{targets}', String(snapshot.generationTargets.length))}
      </div>
    </div>
  );
}

function RecoveryDialog({ id, session }: { id: number; session: CreatorInputRecoverySession }) {
  const { messages } = useI18n();
  const c = messages.creator.inputRecovery;
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const conflict = state.status === 'conflict';
  const current = session.getCurrentInput();

  async function resolve(action: () => boolean | void | Promise<boolean | void>) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      if ((await action()) !== false) creatorInputRecoveryRequests.dismiss(id);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && creatorInputRecoveryRequests.cancel()}>
      <DialogContent className="max-w-xl rounded-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{busy ? c.saving : conflict && !failed ? c.conflict : c.error}</DialogTitle>
          {current.title && <div className="truncate text-sm text-muted-foreground">{current.title}</div>}
        </DialogHeader>
        {conflict ? (
          <Tabs defaultValue="current">
            <TabsList>
              <TabsTrigger value="current">{c.currentPreview}</TabsTrigger>
              <TabsTrigger value="saved">{c.savedPreview}</TabsTrigger>
            </TabsList>
            <TabsContent value="current">
              <InputPreview snapshot={current} />
            </TabsContent>
            <TabsContent value="saved">
              <InputPreview snapshot={state.remote?.snapshot ?? null} />
            </TabsContent>
          </Tabs>
        ) : (
          <InputPreview snapshot={current} />
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => creatorInputRecoveryRequests.cancel()}>
            {messages.common.cancel}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void resolve(() => (conflict ? session.useSaved() : session.discardUnsaved()))}
          >
            {conflict ? c.useSaved : c.discard}
          </Button>
          <Button
            disabled={busy}
            onClick={() => void resolve(() => (conflict ? session.keepCurrent() : session.retry()))}
          >
            {conflict ? c.keepCurrent : c.retry}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Mounted outside workspace visibility and exit-drain inertness so retained sessions always have usable controls. */
export function CreatorInputRecoveryDialog() {
  const request = useSyncExternalStore(
    creatorInputRecoveryRequests.subscribe,
    creatorInputRecoveryRequests.getSnapshot,
  );
  return request ? <RecoveryDialog key={request.id} {...request} /> : null;
}

import { useState } from 'react';
import { CircleAlertIcon, ImageIcon, ImagePlusIcon, LoaderCircleIcon, XIcon } from 'lucide-react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { TermMediaPickerDialog } from '@/renderer/components/dictionary/TermMediaPickerDialog';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { TermIllustrationCandidates } from '@/renderer/features/term-illustration/TermIllustrationCandidates';
import { TermIllustrationHistory } from '@/renderer/features/term-illustration/TermIllustrationHistory';
import { useTermIllustration } from '@/renderer/features/term-illustration/TermIllustrationProvider';
import { qualityLabel, runStatusLabel } from '@/renderer/features/term-illustration/termIllustrationPresentation';

export function TermIllustrationPanel() {
  const { messages } = useI18n();
  const copy = messages.dictionary.detail.illustration;
  const mediaCopy = messages.dictionary.editor;
  const [tab, setTab] = useState('candidates');
  const {
    routes,
    selectedRoute,
    quality,
    count,
    purpose,
    history,
    candidates,
    activeRuns,
    loaded,
    loading,
    actionBusy,
    loadError,
    blockedReason,
    pickerOpen,
    pickerBusy,
    pickerAssets,
    existingAssetIds,
    setPickerOpen,
    openMaterialPicker,
    addPickedMedia,
    importMedia,
    reload,
    start,
    cancel,
  } = useTermIllustration();

  return (
    <section className="overflow-hidden rounded-2xl border bg-surface" data-term-illustration-panel>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <ImageIcon className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">{copy.title}</h2>
          {candidates.length > 0 && <Badge variant="secondary">{candidates.length}</Badge>}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void openMaterialPicker()}>
          <ImagePlusIcon className="size-3.5" />
          {copy.fromMaterials}
        </Button>
      </header>

      <div className="border-b bg-surface-sunken/45 px-4 py-3 sm:px-5">
        {loading && !history.batches.length ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircleIcon className="size-3.5 animate-spin" />
            {copy.title}
          </div>
        ) : loadError ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-destructive">{copy.operationFailed}</p>
            <Button type="button" variant="outline" size="xs" onClick={() => void reload()}>
              {messages.dictionary.detail.retry}
            </Button>
          </div>
        ) : activeRuns.length > 0 ? (
          <div className="grid gap-2">
            <div className="flex items-center gap-2 text-xs font-medium">
              <LoaderCircleIcon className="size-3.5 animate-spin text-primary" />
              {copy.activeTitle}
            </div>
            {activeRuns.map(({ run }) => {
              const routeName = routes.find((route) => route.key === run.modelKey)?.name ?? run.modelKey;
              return (
                <div key={run.id} className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate">{routeName}</span>
                      <span className="text-muted-foreground">{runStatusLabel(run.status, copy)}</span>
                    </div>
                    {run.progress !== null && (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                        <div
                          className="h-full rounded-full bg-primary transition-[width]"
                          style={{ width: `${Math.round(run.progress * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={actionBusy}
                    onClick={() => void cancel(run.generationRunId)}
                  >
                    <XIcon className="size-3.5" />
                    {copy.cancel}
                  </Button>
                </div>
              );
            })}
          </div>
        ) : blockedReason ? (
          <div className="flex items-start gap-2 text-xs leading-5 text-warning">
            <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>{blockedReason}</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium">{copy.readyTitle}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {purpose === 'COVER' ? copy.purposeCover : copy.purposeRelated} · {selectedRoute?.name} ·{' '}
                {qualityLabel(quality, copy)} · {count}
              </p>
            </div>
            <Button type="button" size="sm" disabled={actionBusy} onClick={() => void start()}>
              <ImagePlusIcon className="size-3.5" />
              {copy.generate}
            </Button>
          </div>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="px-3 sm:px-4">
          <TabsTrigger value="candidates" onClick={() => !loaded && void reload()}>
            {copy.candidates}
            {candidates.length > 0 && <span className="ml-1 tabular-nums">{candidates.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="history" onClick={() => !loaded && void reload()}>
            {copy.history}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="candidates" className="p-4 sm:p-5">
          {loaded ? <TermIllustrationCandidates /> : null}
        </TabsContent>
        <TabsContent value="history" className="p-4 sm:p-5">
          {loaded ? <TermIllustrationHistory /> : null}
        </TabsContent>
      </Tabs>

      <TermMediaPickerDialog
        copy={mediaCopy}
        open={pickerOpen}
        busy={pickerBusy}
        assets={pickerAssets}
        existingAssetIds={existingAssetIds}
        onOpenChange={setPickerOpen}
        onImport={importMedia}
        onAdd={addPickedMedia}
      />
    </section>
  );
}

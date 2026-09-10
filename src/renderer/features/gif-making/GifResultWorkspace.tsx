import { ChevronDownIcon, EllipsisIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { GifCandidatePreview } from '@/renderer/features/gif-making/GifCandidatePreview';
import { GifAdoptButton } from '@/renderer/features/gif-making/GifAdoptButton';
import { GifGenerationActions, GifGenerationStatus } from '@/renderer/features/gif-making/GifGenerationActions';
import type { GifGenerationModel } from '@/renderer/features/gif-making/useGifGeneration';
import type { GifMakerModel } from '@/renderer/features/gif-making/useGifMaker';
import type { GifGenerationCandidate } from '@/shared/contracts/gif-generation';
import { useI18n } from '@/renderer/i18n/useI18n';

function GifResultDetails({ candidate }: { candidate: GifGenerationCandidate }) {
  const labels = useI18n().messages.creator.gifMaker;
  const { settings, manifest, audit } = candidate;
  const plan = settings.plan;
  const returnMode = plan?.returnMode;
  return (
    <aside className="min-w-0 space-y-4" aria-label={labels.generation.resultDetails}>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">{labels.generation.prompt}</h3>
        <div className="whitespace-pre-wrap break-words text-sm">{settings.prompt}</div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
        <dt className="text-muted-foreground">{labels.frames}</dt>
        <dd className="text-right tabular-nums">{manifest?.frames.length}</dd>
        <dt className="text-muted-foreground">{labels.generation.duration}</dt>
        <dd className="text-right tabular-nums">{settings.durationMs}</dd>
        {returnMode && (
          <>
            <dt className="text-muted-foreground">{labels.generation.returnMode}</dt>
            <dd className="text-right">
              {returnMode === 'CONTINUE'
                ? labels.generation.continueReturn
                : returnMode === 'REVERSE'
                  ? labels.generation.reverseReturn
                  : labels.generation.oneWay}
            </dd>
          </>
        )}
      </dl>
      {plan && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group px-0">
              <ChevronDownIcon className="size-3 transition-transform group-data-[state=open]:rotate-180" />
              {labels.generation.resultDetails}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-3 text-sm">
            <dl className="space-y-3">
              <div>
                <dt className="text-xs text-muted-foreground">{labels.generation.subject}</dt>
                <dd className="whitespace-pre-wrap break-words">{plan.subject}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{labels.generation.preserve}</dt>
                <dd className="whitespace-pre-wrap break-words">{plan.preserve}</dd>
              </div>
            </dl>
            <ol className="list-decimal space-y-3 pl-5" aria-label={labels.generation.storyboard}>
              {plan.states.map((state, index) => (
                <li key={index} className="whitespace-pre-wrap break-words">
                  {state}
                </li>
              ))}
            </ol>
          </CollapsibleContent>
        </Collapsible>
      )}
      {audit && audit.duplicateStates.length > 0 && (
        <div role="status" className="text-xs text-muted-foreground">
          {labels.generation.duplicateStates}: {audit.duplicateStates.map((index) => index + 1).join(', ')}
        </div>
      )}
    </aside>
  );
}

export function GifResultWorkspace({
  model,
  motion,
  candidate,
  hasEditor,
  alreadyAdopted,
  onSetup,
  onSaveGroup,
  savingGroup,
}: {
  model: GifMakerModel;
  motion: GifGenerationModel;
  candidate: GifGenerationCandidate | null;
  hasEditor: boolean;
  alreadyAdopted: boolean;
  onSetup(): void;
  onSaveGroup(): void;
  savingGroup: boolean;
}) {
  const { labels } = model;
  const navigationDisabled = model.busy || motion.adopting || savingGroup;
  const disabled = navigationDisabled || motion.running;
  if (!candidate?.manifest) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4">
        <div role="status" className="text-sm text-muted-foreground">
          {model.project.error ? (
            labels.errors[model.project.error]
          ) : motion.running ? (
            <GifGenerationStatus motion={motion} />
          ) : motion.historyLoading ? (
            labels.loading
          ) : (
            labels.generation.noResults
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={navigationDisabled} onClick={onSetup}>
            {labels.generation.backToSetup}
          </Button>
          {motion.running && <GifGenerationActions motion={motion} disabled={model.busy} />}
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h3 className="min-w-0 flex-1 break-words text-sm font-medium">
            {candidate.settings.plan?.title || labels.generation.candidate}
          </h3>
          {motion.history.length > 1 && (
            <Select value={candidate.id} onValueChange={motion.selectCandidate} disabled={navigationDisabled}>
              <SelectTrigger className="h-8 w-56" aria-label={labels.generation.results}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {motion.history.map((item, index) => (
                  <SelectItem key={item.id} value={item.id}>
                    {labels.generation.candidate} {motion.history.length - index} ·{' '}
                    {new Date(item.createdAt).toLocaleString()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="grid items-start gap-6 @min-[800px]/gif-maker:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]">
          <div className="min-w-0 @min-[800px]/gif-maker:sticky @min-[800px]/gif-maker:top-0">
            <GifCandidatePreview key={candidate.id} candidate={candidate} onError={motion.failedPreview} />
          </div>
          <GifResultDetails candidate={candidate} />
        </div>
      </div>
      <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t px-4 py-3">
        <div role="status" className="min-w-0 flex-1 text-xs text-muted-foreground">
          {model.project.error ? (
            labels.errors[model.project.error]
          ) : motion.running ? (
            <GifGenerationStatus motion={motion} />
          ) : alreadyAdopted ? (
            labels.adopted
          ) : null}
        </div>
        {motion.running && <GifGenerationActions motion={motion} disabled={model.busy} />}
        <Button variant="ghost" size="sm" disabled={navigationDisabled} onClick={onSetup}>
          {labels.generation.backToSetup}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" disabled={disabled} aria-label={labels.generation.resultActions}>
              <EllipsisIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {hasEditor && (
              <DropdownMenuItem onSelect={() => void motion.adopt(true)}>
                {labels.generation.useAsNewProject}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={onSaveGroup}>{labels.saveFrameGroup}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <GifAdoptButton
          disabled={disabled}
          alreadyAdopted={alreadyAdopted}
          hasEditor={hasEditor}
          onAdopt={() => void motion.adopt()}
        />
      </footer>
    </>
  );
}

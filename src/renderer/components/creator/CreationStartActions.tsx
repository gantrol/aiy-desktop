import { useState } from 'react';
import {
  ChevronDownIcon,
  FileTextIcon,
  FilmIcon,
  ImageIcon,
  ImportIcon,
  LoaderCircleIcon,
  ListTreeIcon,
  VideoIcon,
} from 'lucide-react';
import type { GenerationTargetInput, ImageGenerationRouteDto, Locale } from '@/shared/contracts';
import { GenerationLauncher } from '@/renderer/components/creator/GenerationLauncher';
import type { GenerationReadiness } from '@/renderer/components/creator/generationReadiness';
import { InspirationStashAction } from '@/renderer/components/creator/InspirationStashAction';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

export type CreationStartPlan = { kind: 'manuscript' } | { kind: 'animation' } | { kind: 'outline' };

interface Props {
  locale: Locale;
  routes: ImageGenerationRouteDto[];
  generationTargets: GenerationTargetInput[];
  generationCount: number;
  readiness: GenerationReadiness;
  stashReady: boolean;
  stashing: boolean;
  stashed: boolean;
  startReady: boolean;
  starting: boolean;
  imageToolsOpen?: boolean;
  onStashInspiration(): void;
  onStartCreation(plan: CreationStartPlan): void;
  onOpenExternalImport(): void;
  onChooseVideoDocument(): void;
  onGenerationTargetsChange(targets: GenerationTargetInput[]): void;
  onConfigureExtension(extensionId: string): void;
  onGenerate(): void;
}

export function CreationStartActions({
  locale,
  routes,
  generationTargets,
  generationCount,
  readiness,
  stashReady,
  stashing,
  stashed,
  startReady,
  starting,
  imageToolsOpen: controlledImageToolsOpen,
  onStashInspiration,
  onStartCreation,
  onOpenExternalImport,
  onChooseVideoDocument,
  onGenerationTargetsChange,
  onConfigureExtension,
  onGenerate,
}: Props) {
  const labels = useI18n().messages.creator.startActions;
  const outlineCopy = useI18n().messages.referenceOutline;
  const [localImageToolsOpen, setImageToolsOpen] = useState(false);
  const imageToolsOpen = controlledImageToolsOpen ?? localImageToolsOpen;
  const blocked = starting || stashing;

  return (
    <section data-creation-start-actions className="mt-4 border-t pt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={blocked}
          onClick={() => onStartCreation({ kind: 'outline' })}
          data-action="create-outline"
        >
          <ListTreeIcon className="size-4" />
          {outlineCopy.newOutline}
        </Button>
        <Button
          type="button"
          variant={imageToolsOpen ? 'secondary' : 'ghost'}
          size="sm"
          aria-expanded={imageToolsOpen}
          data-action="toggle-image-tools"
          title={imageToolsOpen ? labels.hideImageTools : labels.showImageTools}
          disabled={blocked}
          onClick={() => setImageToolsOpen((open) => !open)}
        >
          <ImageIcon className="size-4" />
          {labels.image}
          <ChevronDownIcon className={cn('size-3.5 transition-transform', imageToolsOpen && 'rotate-180')} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={blocked}
          onClick={() => onStartCreation({ kind: 'animation' })}
          data-action="create-animation"
        >
          <FilmIcon className="size-4" />
          {labels.animation}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={blocked} onClick={onChooseVideoDocument}>
          <VideoIcon className="size-4" />
          {labels.videoToManuscript}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <InspirationStashAction
            locale={locale}
            ready={stashReady}
            busy={stashing}
            saved={stashed}
            blocked={starting}
            onClick={onStashInspiration}
          />
          <Button
            data-action="create-manuscript"
            type="button"
            size="lg"
            disabled={!startReady || blocked}
            aria-busy={starting}
            onClick={() => onStartCreation({ kind: 'manuscript' })}
          >
            {starting ? <LoaderCircleIcon className="size-4 animate-spin" /> : <FileTextIcon className="size-4" />}
            {labels.manuscript}
          </Button>
        </div>
      </div>

      {imageToolsOpen && (
        <div className="mt-3">
          <GenerationLauncher
            locale={locale}
            routes={routes}
            generationTargets={generationTargets}
            generationCount={generationCount}
            readiness={readiness}
            starting={starting}
            interactionBlocked={stashing}
            secondaryAction={
              <Button
                data-action="import-external-creation"
                type="button"
                variant="ghost"
                size="sm"
                disabled={blocked}
                onClick={onOpenExternalImport}
              >
                <ImportIcon className="size-4" />
                {labels.importImages}
              </Button>
            }
            onGenerationTargetsChange={onGenerationTargetsChange}
            onConfigureExtension={onConfigureExtension}
            onGenerate={onGenerate}
          />
        </div>
      )}
    </section>
  );
}

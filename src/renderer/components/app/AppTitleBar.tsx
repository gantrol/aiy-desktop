import type {
  AssistantRunDto,
  CodexHealth,
  DirectionExperimentDirectorTaskDto,
  ImageGenerationRouteDto,
  GenerationTaskDto,
  ModelWorkerStatusDto,
  PromptSeriesDto,
  VideoDocumentTranscriptBackgroundTask,
} from '@/shared/contracts';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import type { AppView } from '@/renderer/components/app/AppSidebar';
import { AppIconMenu } from '@/renderer/components/app/AppIconMenu';
import { GenerationStatusPopover } from '@/renderer/components/app/GenerationStatusPopover';
import { AppWindowControls } from '@/renderer/components/app/AppWindowControls';

interface Props {
  workerStatus: ModelWorkerStatusDto | null;
  codexHealth: CodexHealth | null;
  generationTasks: GenerationTaskDto[];
  transcriptBackgroundTasks: VideoDocumentTranscriptBackgroundTask[];
  imageGenerationRoutes: ImageGenerationRouteDto[];
  assistantRuns: AssistantRunDto[];
  agentTasks: DirectionExperimentDirectorTaskDto[];
  series: PromptSeriesDto[];
  view: AppView;
  menuDisabled: boolean;
  codexImagesVisible: boolean;
  transitionShowcaseVisible: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  notify(message: string): void;
  onNewCreation(): void;
  onViewChange(view: AppView): void;
  onSettingsOpen(): void;
  onQuit(): void;
  onGoBack(): void;
  onGoForward(): void;
  onGenerationCancel(runId: string): Promise<void>;
  onTranscriptRecognitionCancel(operationId: string): Promise<void>;
  onGenerationRetry(runId: string): Promise<void>;
  onGenerationReEdit(runId: string): void;
}

export function AppTitleBar({
  workerStatus,
  codexHealth,
  generationTasks,
  transcriptBackgroundTasks,
  imageGenerationRoutes,
  assistantRuns,
  agentTasks,
  series,
  view,
  menuDisabled,
  codexImagesVisible,
  transitionShowcaseVisible,
  canGoBack,
  canGoForward,
  notify,
  onNewCreation,
  onViewChange,
  onSettingsOpen,
  onQuit,
  onGoBack,
  onGoForward,
  onGenerationCancel,
  onTranscriptRecognitionCancel,
  onGenerationRetry,
  onGenerationReEdit,
}: Props) {
  const { messages } = useI18n();
  const labels = messages.app.navigation;
  return (
    <TooltipProvider>
      <header
        data-app-title-bar
        className="app-title-bar relative flex h-9 items-center border-b bg-muted pl-3 pr-36 text-xs text-muted-foreground"
      >
        <div className="app-title-bar-actions flex min-w-0 items-center">
          <AppIconMenu
            view={view}
            disabled={menuDisabled}
            codexImagesVisible={codexImagesVisible}
            transitionShowcaseVisible={transitionShowcaseVisible}
            onNewCreation={onNewCreation}
            onViewChange={onViewChange}
            onSettingsOpen={onSettingsOpen}
            onQuit={onQuit}
          />
        </div>
        <nav className="app-title-bar-actions ml-3 flex items-center gap-0.5" aria-label={labels.history}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                data-action="navigate-back"
                variant="ghost"
                size="icon-sm"
                className="size-7 text-muted-foreground"
                disabled={!canGoBack}
                aria-label={labels.back}
                aria-keyshortcuts="Alt+ArrowLeft"
                onClick={onGoBack}
              >
                <ChevronLeftIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{labels.back}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                data-action="navigate-forward"
                variant="ghost"
                size="icon-sm"
                className="size-7 text-muted-foreground"
                disabled={!canGoForward}
                aria-label={labels.forward}
                aria-keyshortcuts="Alt+ArrowRight"
                onClick={onGoForward}
              >
                <ChevronRightIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{labels.forward}</TooltipContent>
          </Tooltip>
        </nav>
        <div className="app-title-bar-actions ml-auto">
          <GenerationStatusPopover
            workerStatus={workerStatus}
            codexHealth={codexHealth}
            tasks={generationTasks}
            transcriptTasks={transcriptBackgroundTasks}
            routes={imageGenerationRoutes}
            assistantRuns={assistantRuns}
            agentTasks={agentTasks}
            series={series}
            onCancel={onGenerationCancel}
            onTranscriptCancel={onTranscriptRecognitionCancel}
            onRetry={onGenerationRetry}
            onReEdit={onGenerationReEdit}
            notify={notify}
          />
        </div>
        <AppWindowControls />
      </header>
    </TooltipProvider>
  );
}

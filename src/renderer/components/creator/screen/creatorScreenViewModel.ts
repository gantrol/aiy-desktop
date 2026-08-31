import type { CreatorScreenProps } from '@/renderer/components/creator/screen/creatorScreenTypes';
import type { useCreatorDraftInputSession } from '@/renderer/components/creator/screen/useCreatorDraftInputSession';
import type { useCreatorGenerationInputSession } from '@/renderer/components/creator/screen/useCreatorGenerationInputSession';
import type { useCreatorGenerationRuntime } from '@/renderer/components/creator/screen/useCreatorGenerationRuntime';
import type { useCreatorLibraryRuntime } from '@/renderer/components/creator/screen/useCreatorLibraryRuntime';
import type { useCreatorNavigationRuntime } from '@/renderer/components/creator/screen/useCreatorNavigationRuntime';
import type { useCreatorOutputUiState } from '@/renderer/components/creator/screen/useCreatorOutputUiState';
import type { useCreatorPromptSession } from '@/renderer/components/creator/screen/useCreatorPromptSession';
import type { useCreatorScreenProjection } from '@/renderer/components/creator/screen/useCreatorScreenProjection';
import type { useCreatorSelectionSession } from '@/renderer/components/creator/screen/useCreatorSelectionSession';
import type { useCreatorWorkbenchProjection } from '@/renderer/components/creator/screen/useCreatorWorkbenchProjection';
import type { useCreatorWorkflowRuntime } from '@/renderer/components/creator/screen/useCreatorWorkflowRuntime';

export interface CreatorScreenViewModel {
  app: CreatorScreenProps;
  draftInput: ReturnType<typeof useCreatorDraftInputSession>;
  generation: ReturnType<typeof useCreatorGenerationInputSession>;
  generationRuntime: ReturnType<typeof useCreatorGenerationRuntime>;
  library: ReturnType<typeof useCreatorLibraryRuntime>;
  navigation: ReturnType<typeof useCreatorNavigationRuntime>;
  outputUi: ReturnType<typeof useCreatorOutputUiState>;
  projection: ReturnType<typeof useCreatorScreenProjection>;
  prompt: ReturnType<typeof useCreatorPromptSession>;
  selection: ReturnType<typeof useCreatorSelectionSession>;
  workbench: ReturnType<typeof useCreatorWorkbenchProjection>;
  workflow: ReturnType<typeof useCreatorWorkflowRuntime>;
}

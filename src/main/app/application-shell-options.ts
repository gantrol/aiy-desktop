import type { TrayPetalAction } from '@/shared/contracts/tray-menu';

export interface DesktopApplicationShellOptions {
  backgroundColor: string;
  title: string;
  allowWindowPresentation: boolean;
  onSecondInstanceArguments?(commandLine: string[]): void;
  onOpenUrl?(url: string): void;
  backgroundModelTasks?: {
    readonly activeCount: number;
    cancelAll(): Promise<void>;
    abortAll(): void;
  };
  stopManagedLocalModels?(): Promise<void>;
  stopBackgroundFileOperations?(): Promise<void>;
  drainDesktopPetals?(): Promise<boolean>;
  resumeDesktopPetals?(): void;
  desktopPetals?(): { readonly ready: boolean; run(action: TrayPetalAction): Promise<void> } | null;
  clipboardCapture?(): {
    readonly canCapture: boolean;
    readonly canOpenHistory: boolean;
    capture(): Promise<void>;
    openHistory(): Promise<void>;
  } | null;
}

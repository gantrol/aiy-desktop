import { z } from 'zod';
import { appShellMessages, type AppShellMessages } from '@/shared/i18n/app-shell';

const messagesSchema = z
  .object(Object.fromEntries(Object.keys(appShellMessages).map((key) => [key, z.string().max(2_000)])))
  .strict() as unknown as z.ZodType<AppShellMessages>;

export const appShellLanguageSchema = z.object({ locale: z.enum(['en', 'zh']), messages: messagesSchema }).strict();
export type AppShellLanguage = z.infer<typeof appShellLanguageSchema>;
export const trayMenuStateSchema = z
  .object({
    language: appShellLanguageSchema,
    windowReady: z.boolean(),
    petalsReady: z.boolean(),
    taskCount: z.number().int().nonnegative(),
    quittingSoon: z.boolean(),
  })
  .strict();
export type TrayMenuState = z.infer<typeof trayMenuStateSchema>;
export const trayPetalActions = ['petals-open', 'petals-show-all', 'petals-hide-all', 'petals-settings'] as const;
export type TrayPetalAction = (typeof trayPetalActions)[number];
export const trayMenuActionSchema = z.enum(['open', 'quit', 'force-quit', 'dismiss', ...trayPetalActions]);
export type TrayMenuAction = z.infer<typeof trayMenuActionSchema>;

export interface TrayMenuApi {
  state(): Promise<TrayMenuState>;
  onState(callback: (state: TrayMenuState) => void): () => void;
  ready(): void;
  action(action: TrayMenuAction): Promise<void>;
}

export function trayTaskStatus(
  state: Pick<TrayMenuState, 'taskCount' | 'windowReady' | 'quittingSoon'>,
  copy: AppShellMessages,
) {
  if (!state.windowReady) return copy.starting;
  if (state.taskCount > 0) return copy.tasksRunning.replace('{count}', String(state.taskCount));
  return state.quittingSoon ? copy.tasksCompleted : copy.tasksIdle;
}

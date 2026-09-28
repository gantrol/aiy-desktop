import { z } from 'zod';

export interface StartThreadInput {
  cwd: string;
  projectId?: string | null;
  developerInstructions: string;
  webSearchMode?: 'disabled' | 'live';
  ephemeral?: boolean;
  userTask?: boolean;
}
export const threadResponseSchema = z
  .object({
    thread: z.object({ id: z.string().min(1).max(512), sessionId: z.string().max(512).optional() }).passthrough(),
  })
  .passthrough();
export function threadConfiguration(input: Pick<StartThreadInput, 'webSearchMode'>): Record<string, unknown> {
  return input.webSearchMode ? { config: { web_search: input.webSearchMode } } : {};
}

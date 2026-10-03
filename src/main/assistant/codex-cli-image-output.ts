import { constants } from 'node:fs';
import { copyFile, lstat, opendir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { codexImageOutputError } from '@/main/assistant/codex-image-output';
import { validatePngFileAsync } from '@/main/media/png-validation';

const cliEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('thread.started'), thread_id: z.string().uuid() }),
  z.object({
    type: z.literal('item.completed'),
    item: z.object({ type: z.literal('agent_message'), text: z.string().max(16_000) }),
  }),
]);
const MAX_THREAD_ENTRIES = 32;

function cliImageContext(stdout: string) {
  const threadIds = new Set<string>();
  let finalMessage = '';
  for (const line of stdout.split(/\r?\n/)) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const event = cliEventSchema.safeParse(value);
    if (!event.success) continue;
    if (event.data.type === 'thread.started') threadIds.add(event.data.thread_id);
    else finalMessage = event.data.item.text;
  }
  return { threadId: threadIds.size === 1 ? [...threadIds][0] : null, finalMessage };
}

async function fileStats(filePath: string) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function invalidImageOutput() {
  return Object.assign(new Error('IMAGE_GENERATION_INVALID_OUTPUT'), { code: 'IMAGE_GENERATION_INVALID_OUTPUT' });
}

async function singleThreadImage(threadId: string) {
  const codexHome = process.env.CODEX_HOME?.trim() || path.join(homedir(), '.codex');
  const directory = path.resolve(codexHome, 'generated_images', threadId);
  const stats = await fileStats(directory);
  if (!stats?.isDirectory() || stats.isSymbolicLink()) return null;
  let imagePath: string | null = null;
  let entries = 0;
  for await (const entry of await opendir(directory)) {
    entries += 1;
    if (entries > MAX_THREAD_ENTRIES) {
      throw codexImageOutputError(null, 'CODEX_IMAGE_OUTPUT_AMBIGUOUS');
    }
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.png') continue;
    if (imagePath) throw codexImageOutputError(null, 'CODEX_IMAGE_OUTPUT_AMBIGUOUS');
    imagePath = path.join(directory, entry.name);
  }
  return imagePath;
}

/** Collect only this CLI invocation's image; shell access is not required for delivery. */
export async function collectCodexCliImageOutput(stdout: string, outputPath: string) {
  if (await fileStats(outputPath)) {
    if (!(await validatePngFileAsync(outputPath))) throw invalidImageOutput();
    return outputPath;
  }

  const { threadId, finalMessage } = cliImageContext(stdout);
  const source = threadId ? await singleThreadImage(threadId) : null;
  if (!source) throw codexImageOutputError(null, finalMessage);
  if (!(await validatePngFileAsync(source))) throw invalidImageOutput();
  // Preserve Codex's original and never overwrite a file created during collection.
  await copyFile(source, outputPath, constants.COPYFILE_EXCL);
  if (!(await validatePngFileAsync(outputPath))) throw invalidImageOutput();
  return outputPath;
}

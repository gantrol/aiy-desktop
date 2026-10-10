import { z } from 'zod';
import { videoSearchInputSchema } from '@/shared/contracts/video-search';

export const videoSearchCommandSchema = z.object({
  op: z.literal('video-search'),
  databasePath: z.string(),
  libraryRoot: z.string(),
  ffmpeg: z.string(),
  ffprobe: z.string(),
  input: videoSearchInputSchema,
});

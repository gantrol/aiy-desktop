import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { imageSearchDeviceSchema, type ImageSearchDevice } from '@/shared/contracts/image-search';
import { resolveOnnxRuntime } from '@/main/image-search/native-runtime';

export const imageSearchRuntimeSchema = z
  .object({
    model: z.string().min(1),
    device: imageSearchDeviceSchema.default('AUTO'),
  })
  .strict();
export type ImageSearchRuntime = z.infer<typeof imageSearchRuntimeSchema> & {
  fingerprint: string;
  nativeBindingPath?: string;
};

const configurationSchema = imageSearchRuntimeSchema.partial({ model: true });
const updates = new Map<string, Promise<void>>();

export async function readImageSearchConfiguration(configurationPath: string) {
  const raw = await readFile(configurationPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return '{}';
    throw error;
  });
  return configurationSchema.parse(JSON.parse(raw));
}

function saveConfiguration(configurationPath: string, change: { model?: string; device?: ImageSearchDevice }) {
  const previous = updates.get(configurationPath) ?? Promise.resolve();
  const update = previous
    .catch(() => undefined)
    .then(async () => {
      const saved = await readImageSearchConfiguration(configurationPath).catch((error: unknown) => {
        // Selecting a model is also the recovery path for a malformed old configuration.
        if (change.model && (error instanceof SyntaxError || error instanceof z.ZodError))
          return { device: 'AUTO' as const };
        throw error;
      });
      const configuration = { ...saved, ...change };
      await mkdir(path.dirname(configurationPath), { recursive: true });
      const temporary = `${configurationPath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(configuration), { flag: 'wx' });
        if (change.model) await resolveImageSearchRuntime(temporary, false, false);
        await rename(temporary, configurationPath);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    });
  updates.set(configurationPath, update);
  void update
    .finally(() => {
      if (updates.get(configurationPath) === update) updates.delete(configurationPath);
    })
    .catch(() => undefined);
  return update;
}

export function saveImageSearchModel(configurationPath: string, model: string) {
  return saveConfiguration(configurationPath, { model });
}

export function saveImageSearchDevice(configurationPath: string, device: ImageSearchDevice) {
  return saveConfiguration(configurationPath, { device: imageSearchDeviceSchema.parse(device) });
}

const modelFiles = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'processor_config.json',
  'preprocessor_config.json',
  'onnx/model_quantized.onnx',
  'onnx/model_quantized.onnx_data',
  'onnx/vision_encoder_quantized.onnx',
  'onnx/vision_encoder_quantized.onnx_data',
];

export async function resolveImageSearchRuntime(
  configurationPath: string,
  useEnvironment = true,
  requireNativeRuntime = true,
): Promise<ImageSearchRuntime> {
  const configuration = await readImageSearchConfiguration(configurationPath);
  if (useEnvironment && process.env.AIY_IMAGE_SEARCH_MODEL) configuration.model = process.env.AIY_IMAGE_SEARCH_MODEL;
  if (!configuration.model) throw new Error('NOT_CONFIGURED');
  const input = imageSearchRuntimeSchema.parse(configuration);
  if (!path.isAbsolute(input.model)) throw new Error('NOT_CONFIGURED');
  const model = await realpath(input.model);
  const config = JSON.parse(await readFile(path.join(model, 'config.json'), 'utf8')) as { model_type?: string };
  if (config.model_type !== 'embedding_gemma2') throw new Error('NOT_CONFIGURED');
  // Include local weight/config revisions so replacing a snapshot cannot reuse incompatible vectors.
  // Keep the original Q8 vector-format identifier across devices; device changes only restart sessions.
  const signature: unknown[] = [model, 'transformers.js-4.3.1-embeddinggemma2-q8-cpu-768-image-v1'];
  for (const name of modelFiles) {
    const filePath = await realpath(path.join(model, name));
    const relative = path.relative(model, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('NOT_CONFIGURED');
    const info = await stat(filePath);
    if (!info.isFile() || !info.size) throw new Error('NOT_CONFIGURED');
    signature.push([name, info.size, info.mtimeMs]);
  }
  const nativeBindingPath = requireNativeRuntime
    ? await resolveOnnxRuntime(path.dirname(configurationPath))
    : undefined;
  return {
    model,
    device: input.device,
    fingerprint: createHash('sha256').update(JSON.stringify(signature)).digest('hex'),
    ...(nativeBindingPath ? { nativeBindingPath } : {}),
  };
}

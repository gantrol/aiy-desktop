import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ImageSearchEncoder } from '@/main/image-search/encoder';
import { digest, hashFile } from '@/main/model-training/io';
import { validateDataset } from '@/main/model-training/dataset';
import type { TrainingSnapshot } from '@/shared/model-training';

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

export async function modelContract(directory: string) {
  const root = await realpath(directory);
  const files: Record<string, string> = {};
  const signature: unknown[] = [root, 'transformers.js-4.3.1-embeddinggemma2-q8-cpu-768-image-v1'];
  let total = 0;
  for (const name of modelFiles) {
    const file = await realpath(path.join(root, name));
    if (!file.startsWith(root + path.sep)) throw new Error('MODEL_PATH_OUTSIDE_ROOT');
    const info = await stat(file);
    total += info.size;
    if (total > 4 * 1024 ** 3) throw new Error('MODEL_BYTE_BUDGET');
    files[name] = await hashFile(file);
    signature.push([name, info.size, info.mtimeMs]);
  }
  return {
    root,
    files,
    modelDigest: digest(files),
    runtimeFingerprint: createHash('sha256').update(JSON.stringify(signature)).digest('hex'),
  };
}

async function checkModelRevision(contract: Awaited<ReturnType<typeof modelContract>>) {
  const signature: unknown[] = [contract.root, 'transformers.js-4.3.1-embeddinggemma2-q8-cpu-768-image-v1'];
  for (const name of modelFiles) {
    const info = await stat(path.join(contract.root, name));
    signature.push([name, info.size, info.mtimeMs]);
  }
  if (createHash('sha256').update(JSON.stringify(signature)).digest('hex') !== contract.runtimeFingerprint)
    throw new Error('MODEL_CHANGED_DURING_CAPTURE');
}

export async function captureDataset(raw: unknown, directory: string, device: 'CPU' | 'GPU', signal: AbortSignal) {
  const started = performance.now();
  const dataset = validateDataset(raw);
  const contract = await modelContract(directory);
  let encoder = new ImageSearchEncoder(contract.root, 'index', device);
  const images: TrainingSnapshot['images'] = Object.create(null);
  const queries: TrainingSnapshot['queries'] = Object.create(null);
  const queryMs: Record<string, number> = Object.create(null);
  let bytes = 0;
  try {
    for (const entry of dataset.entries) {
      signal.throwIfAborted();
      if (entry.path.toLowerCase().includes('trash')) throw new Error('EXCLUDED_SOURCE_PATH');
      const source = await realpath(entry.path);
      if (source.toLowerCase().includes('trash')) throw new Error('EXCLUDED_SOURCE_PATH');
      const before = await stat(source);
      bytes += before.size;
      if (bytes > 512 * 1024 * 1024) throw new Error('CORPUS_BYTE_BUDGET');
      if ((await hashFile(source, 32 * 1024 * 1024)) !== entry.revision) throw new Error('SOURCE_REVISION_MISMATCH');
      const vector = await encoder.image(source, () => signal.throwIfAborted());
      const after = await stat(source);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('SOURCE_CHANGED');
      if (!vector) throw new Error(`IMAGE_UNAVAILABLE:${entry.id}`);
      images[entry.id] = Array.from(vector);
      console.error(
        JSON.stringify({ phase: 'images', completed: Object.keys(images).length, total: dataset.entries.length }),
      );
    }
    await encoder.dispose();
    encoder = new ImageSearchEncoder(contract.root, 'search', device);
    for (const item of dataset.cases) {
      signal.throwIfAborted();
      const begin = performance.now();
      queries[item.id] = Array.from(await encoder.query(item.query));
      queryMs[item.id] = performance.now() - begin;
      console.error(
        JSON.stringify({ phase: 'queries', completed: Object.keys(queries).length, total: dataset.cases.length }),
      );
    }
    await checkModelRevision(contract);
    return {
      schema: 1 as const,
      datasetId: digest(dataset),
      dataset,
      modelDigest: contract.modelDigest,
      runtimeFingerprint: contract.runtimeFingerprint,
      encoderVersion: 'q8-image-query-768-v1' as const,
      modelFiles: contract.files,
      device,
      createdAt: new Date().toISOString(),
      prepareMs: performance.now() - started,
      images,
      queries,
      queryMs,
    };
  } finally {
    await encoder.dispose();
  }
}

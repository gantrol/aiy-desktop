import { stat } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import {
  AutoConfig,
  AutoModel,
  AutoProcessor,
  RawImage,
  Tensor,
  env,
  type PreTrainedModel,
  type Processor,
} from '@huggingface/transformers';
import sharp from 'sharp';
import { listSupportedBackends } from 'onnxruntime-node';
import type { ImageSearchDevice, ImageSearchExecution } from '@/shared/contracts/image-search';
import { writeWorkerDiagnostic } from '@/main/extensions/worker-diagnostics';

env.allowRemoteModels = false;
env.useFSCache = false;
sharp.cache(false);
sharp.concurrency(1);

/** Runs inside an isolated process; automatic GPU failures fall back once to bounded CPU inference. */
export class ImageSearchEncoder {
  private model: PreTrainedModel | null = null;
  private processor: Processor | null = null;
  private queries = new Map<string, Float32Array>();
  private backend: 'cpu' | 'webgpu' | null = null;
  private completedBackend: ImageSearchExecution['backend'] = null;
  private fallback = false;

  constructor(
    private readonly directory: string,
    private readonly role: 'search' | 'index' | 'content',
    private readonly device: ImageSearchDevice = 'AUTO',
  ) {}

  get execution(): ImageSearchExecution {
    return { backend: this.completedBackend, fallback: this.fallback };
  }

  async dispose() {
    const model = this.model;
    this.model = null;
    this.processor = null;
    this.queries.clear();
    this.completedBackend = null;
    await model?.dispose();
  }

  private async load() {
    if (this.model) return;
    if (!this.backend) {
      writeWorkerDiagnostic('backend-detecting', { device: this.device, role: this.role });
      const gpu = listSupportedBackends().some((backend) => backend.name === 'webgpu' && backend.bundled);
      writeWorkerDiagnostic('backend-detected', { webgpuAvailable: gpu });
      if (this.device === 'GPU' && !gpu) throw new Error('GPU_UNAVAILABLE');
      // The bundled Q8 vision graph fails on DirectML dynamic reshapes; use the validated WebGPU path.
      this.backend = this.device !== 'CPU' && gpu ? 'webgpu' : 'cpu';
    }
    writeWorkerDiagnostic('model-loading', { backend: this.backend, role: this.role, dtype: 'q8' });
    const config = await AutoConfig.from_pretrained(this.directory, { local_files_only: true });
    Object.assign(config, { audio_config: null });
    if (this.role !== 'index') Object.assign(config, { vision_config: null });
    this.processor = await AutoProcessor.from_pretrained(this.directory, { local_files_only: true });
    this.model = await AutoModel.from_pretrained(this.directory, {
      config,
      dtype: 'q8',
      device: this.backend,
      local_files_only: true,
      session_options: {
        intraOpNumThreads: Math.max(1, Math.min(2, Math.floor((availableParallelism() - 1) / 2))),
        interOpNumThreads: 1,
        // An idle index session must not spin on CPU while a search runs.
        extra: { session: { intra_op: { allow_spinning: '0' }, inter_op: { allow_spinning: '0' } } },
      },
    });
    writeWorkerDiagnostic('model-ready', { backend: this.backend });
  }

  private async encode(text: string | null, image?: RawImage) {
    try {
      return await this.infer(text, image);
    } catch (error) {
      writeWorkerDiagnostic('inference-failed', { backend: this.backend }, error);
      if (this.backend !== 'webgpu') throw error;
      writeWorkerDiagnostic('session-disposing', { backend: this.backend });
      await this.model?.dispose().catch(() => undefined);
      this.model = null;
      this.completedBackend = null;
      if (this.device === 'GPU') throw new Error('GPU_UNAVAILABLE');
      this.backend = 'cpu';
      this.fallback = true;
      writeWorkerDiagnostic('cpu-fallback');
      return this.infer(text, image);
    }
  }

  private async infer(text: string | null, image?: RawImage) {
    await this.load();
    writeWorkerDiagnostic('input-preparing', { backend: this.backend, image: Boolean(image) });
    const inputs = await this.processor!(text, image);
    let outputs: Record<string, Tensor> | undefined;
    try {
      writeWorkerDiagnostic('inference-started', { backend: this.backend });
      outputs = await this.model!(inputs);
      writeWorkerDiagnostic('inference-finished', { backend: this.backend });
      const tensor = outputs!.sentence_embedding;
      if (!(tensor instanceof Tensor) || tensor.dims.join(',') !== '1,768') throw new Error('INVALID_EMBEDDING');
      const vector = Float32Array.from(tensor.data as Float32Array);
      let norm = 0;
      for (const value of vector) {
        if (!Number.isFinite(value)) throw new Error('INVALID_EMBEDDING');
        norm += value * value;
      }
      if (!norm) throw new Error('INVALID_EMBEDDING');
      const magnitude = Math.sqrt(norm);
      for (let index = 0; index < vector.length; index++) vector[index] /= magnitude;
      this.completedBackend = this.backend;
      return vector;
    } finally {
      writeWorkerDiagnostic('tensors-disposing', { backend: this.backend });
      for (const value of Object.values(inputs)) if (value instanceof Tensor) value.dispose();
      for (const value of Object.values(outputs ?? {})) if (value instanceof Tensor) value.dispose();
      writeWorkerDiagnostic('tensors-disposed', { backend: this.backend });
    }
  }

  async image(filePath: string, checkCancelled: () => void) {
    let image: RawImage;
    try {
      const info = await stat(filePath);
      if (!info.isFile() || info.size <= 0 || info.size > 32 * 1024 * 1024) return null;
      writeWorkerDiagnostic('image-decoding', { bytes: info.size });
      const decoded = await sharp(filePath, { limitInputPixels: 16_000_000, pages: 1, failOn: 'warning' })
        .rotate()
        .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
        .removeAlpha()
        .toColourspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true });
      image = new RawImage(
        new Uint8ClampedArray(decoded.data),
        decoded.info.width,
        decoded.info.height,
        decoded.info.channels,
      );
      writeWorkerDiagnostic('image-decoded', { width: decoded.info.width, height: decoded.info.height });
    } catch (error) {
      writeWorkerDiagnostic('image-decode-failed', {}, error);
      return null;
    }
    checkCancelled();
    return this.encode(null, image);
  }

  async query(query: string) {
    const cached = this.queries.get(query);
    if (cached) return cached;
    // This trained task prefix stays in English; the user's query keeps its original language.
    const vector = await this.encode(`task: search result | query: ${query}`);
    if (this.queries.size >= 32) this.queries.delete(this.queries.keys().next().value!);
    this.queries.set(query, vector);
    return vector;
  }

  async videoFrame(pixels: Uint8Array, width: number, height: number, checkCancelled: () => void) {
    checkCancelled();
    if (width * height > 640 * 640 || pixels.length !== width * height * 3) throw new Error('UNAVAILABLE');
    const vector = await this.encode(null, new RawImage(new Uint8ClampedArray(pixels), width, height, 3));
    checkCancelled();
    return vector;
  }

  async document(title: string, text: string) {
    return this.encode(`title: ${Array.from(title).slice(0, 256).join('') || 'none'} | text: ${text}`);
  }
}

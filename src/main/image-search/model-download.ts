import path from 'node:path';
import type { ImageSearchModelState } from '@/shared/contracts/image-search';
import { saveImageSearchModel } from '@/main/image-search/runtime';
import { downloadVerifiedFiles } from '@/main/image-search/verified-download';
import { downloadOnnxRuntime, onnxRuntimeBytes } from '@/main/image-search/native-runtime';

export const imageSearchModelRevision = 'daa72c51243991dfcaf9f9137d2c573d8f7790c0';
const files = [
  ['config.json', 5031, '8d011bfe08b5e345bbe0b81e5c6fd02c381920b345b986047bc2a33ce7b90d1d'],
  ['preprocessor_config.json', 560, '9344893f8d0573a46ebb2ca54c03f56d044cea194c8dcfb1f4d652240ac21daa'],
  ['processor_config.json', 1788, '168f6a08522f3ce5dea596d94d003af2fd691742d4f41fe1f9d8cce76bfbf69c'],
  ['tokenizer.json', 32170510, '4d777ef5bdc1aa36227abdfb77c3e49e7b9c892d16e1b6bda41c393504828be4'],
  ['tokenizer_config.json', 1599, '17bd5d6e9364ca49a534e1502076593317c298d4a663623091ed45388f004874'],
  ['onnx/model_quantized.onnx', 495165, 'd06edd601f851c633a2519304cbeb8dc6170d7ceb61b436625c17fb9b6e74953'],
  ['onnx/model_quantized.onnx_data', 313724928, '278a7ff1248c3618e4bd11a607fc54f7bdc7778854230f3956d3f86bd9db4f3b'],
  ['onnx/vision_encoder_quantized.onnx', 162495, 'bb0de2df53a2448a32dc7908a187c168c8afd514d4d6f674f7f46024875fa4e3'],
  [
    'onnx/vision_encoder_quantized.onnx_data',
    195228672,
    '3dabd69c0a36e9a8771ad82030dde74daa5a0e02b7047a5d3f3382b1137bab89',
  ],
] as const;

export class ImageSearchModelDownload {
  private controller: AbortController | null = null;
  readonly state: Pick<ImageSearchModelState, 'download' | 'bytes' | 'total'> = {
    download: 'IDLE',
    bytes: 0,
    total: files.reduce((sum, item) => sum + item[1], 0),
  };

  constructor(private readonly userData: string) {}

  cancel() {
    this.controller?.abort();
  }

  start(options = { modelReady: false, runtimeRequired: false }) {
    if (this.controller) return;
    const controller = new AbortController();
    this.controller = controller;
    this.state.download = 'DOWNLOADING';
    this.state.bytes = 0;
    this.state.total =
      (options.modelReady ? 0 : files.reduce((sum, item) => sum + item[1], 0)) +
      (options.runtimeRequired ? onnxRuntimeBytes : 0);
    void this.download(controller.signal, options)
      .then(() => {
        this.state.download = 'READY';
      })
      .catch(() => {
        this.state.download = controller.signal.aborted ? 'IDLE' : 'FAILED';
      })
      .finally(() => {
        this.controller = null;
      });
  }

  private async download(signal: AbortSignal, options: { modelReady: boolean; runtimeRequired: boolean }) {
    const progress = (bytes: number) => {
      this.state.bytes += bytes;
    };
    if (options.runtimeRequired) await downloadOnnxRuntime(this.userData, signal, progress);
    signal.throwIfAborted();
    if (options.modelReady) return;
    const directory = path.join(this.userData, 'models', 'embeddinggemma-2-onnx', imageSearchModelRevision);
    await downloadVerifiedFiles({
      directory,
      files,
      baseUrl: `https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/${imageSearchModelRevision}`,
      allowedHost: (host) =>
        ['huggingface.co', 'cas-bridge.xethub.hf.co', 'cdn-lfs.huggingface.co', 'cdn-lfs-us-1.hf.co'].includes(host) ||
        host.endsWith('.cdn.hf.co'),
      signal,
      progress,
    });
    signal.throwIfAborted();
    await saveImageSearchModel(path.join(this.userData, 'image-search-runtime.json'), directory);
  }
}

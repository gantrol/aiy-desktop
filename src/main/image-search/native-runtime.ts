import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadVerifiedFiles, verifiedFile, type DownloadFile } from '@/main/image-search/verified-download';

// Pinned to package-lock.json. Keep all CPU / WebGPU dependencies from the same build.
export const onnxRuntimeVersion = '1.30.0';
export const onnxRuntimeFiles = [
  ['DirectML.dll', 18527584, '234e8898778cdec88d3cb0539508273494082812c968699f3de665a018971625'],
  ['dxcompiler.dll', 17986360, '593d42df78c7f9cbd97c1374af107cfe20985759f98b77afc1448fe41ee3cc76'],
  ['dxil.dll', 1508664, 'cf9a3981263f8ec30c9905d136eeaf4b4573209c602198671b958ec86905dea8'],
  ['onnxruntime.dll', 28754232, '508c362f5673483dd3a086379c392795b2e42d10d5e6f3f90ebd7ac21c97af67'],
  ['onnxruntime_binding.node', 298848, 'ddd428464069b84414d34ec1796c7c2a69c33a976e4b0390692629e394f92fa1'],
] as const satisfies readonly DownloadFile[];
export const onnxRuntimeBytes = onnxRuntimeFiles.reduce((sum, file) => sum + file[1], 0);
const verifiedDirectories = new Map<string, string>();

export function onnxRuntimeDirectory(userData: string) {
  return path.join(userData, 'runtimes', 'onnxruntime-node', onnxRuntimeVersion, 'win32-x64');
}

export function needsManagedOnnxRuntime() {
  // Windows packaging intentionally omits native ONNX files. Recognize both
  // Electron's archive and its sidecar chunks without synchronous module lookup
  // or consulting the working directory. Development and macOS keep npm's runtime.
  return (
    process.platform === 'win32' &&
    process.arch === 'x64' &&
    /[/\\]app\.asar(?:\.unpacked)?[/\\]/.test(fileURLToPath(import.meta.url))
  );
}

/** Hash before loading executable content; unchanged files are cheap to poll in the host. */
export async function verifyOnnxRuntime(directory: string, signal = new AbortController().signal) {
  const signature: unknown[] = [];
  for (const [name, bytes] of onnxRuntimeFiles) {
    const info = await stat(path.join(directory, name));
    if (!info.isFile() || info.size !== bytes) throw new Error('NOT_CONFIGURED');
    signature.push([name, info.size, info.mtimeMs, info.ctimeMs]);
  }
  const key = JSON.stringify(signature);
  if (verifiedDirectories.get(directory) === key) return;
  for (const [name, bytes, digest] of onnxRuntimeFiles) {
    if (!(await verifiedFile(path.join(directory, name), bytes, digest, signal))) throw new Error('NOT_CONFIGURED');
  }
  // Each process normally has one user-data directory; do not retain an unbounded path cache.
  verifiedDirectories.clear();
  verifiedDirectories.set(directory, key);
}

export async function resolveOnnxRuntime(userData: string) {
  if (!needsManagedOnnxRuntime()) return undefined;
  const directory = onnxRuntimeDirectory(userData);
  await verifyOnnxRuntime(directory);
  return path.join(directory, 'onnxruntime_binding.node');
}

export async function downloadOnnxRuntime(userData: string, signal: AbortSignal, progress: (bytes: number) => void) {
  await downloadVerifiedFiles({
    directory: onnxRuntimeDirectory(userData),
    files: onnxRuntimeFiles,
    baseUrl: `https://unpkg.com/onnxruntime-node@${onnxRuntimeVersion}/bin/napi-v6/win32/x64`,
    allowedHost: (host) => host === 'unpkg.com',
    signal,
    progress,
  });
}

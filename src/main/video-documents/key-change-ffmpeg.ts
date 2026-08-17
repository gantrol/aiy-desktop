import type { ChildProcess } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';

const maximumStderrBytes = 64 * 1024;
const keyChangeStageTimeoutMs = 15 * 60_000;
const ffmpegTerminationGraceMs = 2_000;

export function ffmpegExecutable() {
  const configured = process.env.AIY_FFMPEG_PATH?.trim();
  if (configured) return configured;
  const executable = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const bundled = process.resourcesPath ? path.join(process.resourcesPath, 'ffmpeg', executable) : null;
  try {
    if (bundled && statSync(bundled).isFile()) return bundled;
  } catch {
    // Development uses PATH until a redistributable FFmpeg sidecar is selected.
  }
  return executable;
}

export function ffmpegSampleInterval(durationMs: number, maximumFrames: number) {
  const requiredInterval = Math.ceil(durationMs / Math.max(1, maximumFrames - 1));
  return Math.max(1_000, Math.ceil(requiredInterval / 1_000) * 1_000);
}

export function isPathInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function frameCaptureTerminationError(reason: 'cancelled' | 'timeout') {
  return new Error(
    reason === 'timeout' ? 'VIDEO_DOCUMENT_FRAME_CAPTURE_TIMEOUT' : 'VIDEO_DOCUMENT_FRAME_CAPTURE_CANCELLED',
  );
}

export function throwIfFrameCaptureCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw frameCaptureTerminationError('cancelled');
}

export function appendBoundedStderr(current: string, chunk: Buffer) {
  const next = current + chunk.toString('utf8');
  return next.length <= maximumStderrBytes ? next : next.slice(next.length - maximumStderrBytes);
}

export function ffmpegFailure(errorOutput: string) {
  const detail = errorOutput.trim().split(/\r?\n/).slice(-4).join(' | ').slice(0, 1_000);
  return new Error(detail ? `VIDEO_KEY_CHANGES_FFMPEG_FAILED: ${detail}` : 'VIDEO_KEY_CHANGES_FFMPEG_FAILED');
}

export function keyChangeTerminationError(reason: 'cancelled' | 'timeout') {
  return new Error(reason === 'timeout' ? 'VIDEO_KEY_CHANGES_TIMEOUT' : 'VIDEO_KEY_CHANGES_CANCELLED');
}

export function keyChangeAbortError(signal?: AbortSignal) {
  const reason: unknown = signal?.reason;
  return reason instanceof Error && reason.message === 'VIDEO_KEY_CHANGES_TIMEOUT'
    ? reason
    : keyChangeTerminationError('cancelled');
}

export function throwIfKeyChangeCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw keyChangeAbortError(signal);
}

export async function waitForKeyChangeFfmpeg(
  child: ChildProcess,
  signal: AbortSignal | undefined,
  failure: () => Error,
  operationError?: () => Error | null,
) {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let processError: NodeJS.ErrnoException | null = null;
    let terminationError: Error | null = null;
    let forceTerminationTimer: NodeJS.Timeout | null = null;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceTerminationTimer) clearTimeout(forceTerminationTimer);
      signal?.removeEventListener('abort', cancel);
      operation();
    };
    const terminate = (error: Error) => {
      if (terminationError) return;
      terminationError = error;
      child.kill();
      forceTerminationTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, ffmpegTerminationGraceMs);
      forceTerminationTimer.unref();
    };
    const cancel = () => terminate(keyChangeAbortError(signal));
    const timeout = setTimeout(() => terminate(keyChangeTerminationError('timeout')), keyChangeStageTimeoutMs);
    timeout.unref();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    child.once('error', (error: NodeJS.ErrnoException) => {
      processError = error;
    });
    child.once('close', (code) => {
      finish(() => {
        const taskError = operationError?.();
        if (terminationError) reject(terminationError);
        else if (taskError) reject(taskError);
        else if (processError?.code === 'ENOENT') reject(new Error('VIDEO_KEY_CHANGES_FFMPEG_UNAVAILABLE'));
        else if (processError) reject(new Error(`VIDEO_KEY_CHANGES_FFMPEG_START_FAILED: ${processError.message}`));
        else if (code !== 0) reject(failure());
        else resolve();
      });
    });
  });
}

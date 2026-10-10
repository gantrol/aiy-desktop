import { dialog, shell } from 'electron';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { CaptureBounds } from '@/main/clipboard-capture/capture-session';
import type { WindowsClipboardClient } from '@/main/clipboard-capture/windows-client';

async function executable() {
  const configured = process.env.AIY_FFMPEG_PATH?.trim();
  if (configured) return configured;
  const bundled = path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe');
  if (
    await stat(bundled).then(
      (value) => value.isFile(),
      () => false,
    )
  )
    return bundled;
  return 'ffmpeg.exe';
}

/** A single pending fragmented MP4 survives cancellation, lock and application restart. */
export async function captureRecording(
  root: string,
  bounds: CaptureBounds,
  cursor: boolean,
  helper: WindowsClipboardClient,
  signal: AbortSignal,
) {
  if (bounds.width * bounds.height > 8_294_400) throw new Error('recordTooLarge');
  await mkdir(root, { recursive: true });
  const file = path.join(root, 'pending.mp4');
  const recoveredSize = await stat(file).then(
    (value) => value.size,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    },
  );
  const recovered = recoveredSize !== null;
  let child: ReturnType<typeof spawn> | undefined;
  let exited: Promise<number> = Promise.resolve(0);
  let ready = recovered,
    stopped = false,
    settled = false,
    handling = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let resolve!: (result: boolean) => void;
  const done = new Promise<boolean>((finish) => {
    resolve = finish;
  });
  const finish = (result: boolean) => {
    if (!settled) {
      settled = true;
      resolve(result);
    }
  };
  const state = (phase: 'recording' | 'ready', message: string) => {
    if (!helper.closed && !signal.aborted) helper.recordingState(phase, message);
  };
  const stop = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return exited;
    if (!stopped) {
      stopped = true;
      child.stdin?.write('q\n');
      killTimer = setTimeout(() => child?.kill(), 5000);
    }
    return exited;
  };
  const abort = () => {
    void stop().finally(() => finish(false));
  };
  const unsubscribe = helper.onRecordingControl(async (action) => {
    if (handling || settled) return;
    handling = true;
    try {
      if (action === 'stop') await stop();
      if (action === 'cancel') {
        await stop();
        await unlink(file).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
        finish(true);
      }
      if (ready && action === 'preview') {
        if (await shell.openPath(file)) throw new Error('recordPreview');
      }
      if (ready && action === 'save') {
        const output = await dialog.showSaveDialog({
          defaultPath: `Recording-${new Date().toISOString().replace(/[:.]/gu, '-')}.mp4`,
          filters: [{ name: 'MP4', extensions: ['mp4'] }],
        });
        if (!output.canceled && output.filePath) {
          if (path.resolve(output.filePath).toLowerCase() === path.resolve(file).toLowerCase())
            throw new Error('storage');
          await copyFile(file, output.filePath);
          await unlink(file);
          finish(true);
        }
      }
    } catch (error) {
      state(
        ready ? 'ready' : 'recording',
        error instanceof Error && error.message === 'recordPreview' ? 'recordPreview' : 'storage',
      );
    } finally {
      handling = false;
    }
  });
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    if (recovered) state('ready', recoveredSize ? 'recordRecovered' : 'recordFailed');
    else {
      const command = await executable();
      signal.throwIfAborted();
      child = spawn(
        command,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-n',
          '-f',
          'gdigrab',
          '-framerate',
          '15',
          '-draw_mouse',
          cursor ? '1' : '0',
          '-offset_x',
          String(bounds.x),
          '-offset_y',
          String(bounds.y),
          '-video_size',
          `${bounds.width}x${bounds.height}`,
          '-i',
          'desktop',
          '-an',
          '-vf',
          'pad=ceil(iw/2)*2:ceil(ih/2)*2',
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-crf',
          '23',
          '-pix_fmt',
          'yuv420p',
          '-g',
          '30',
          '-movflags',
          '+frag_keyframe+empty_moov+default_base_moof',
          '-t',
          '600',
          '-fs',
          String(120 * 1024 * 1024),
          file,
        ],
        { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] },
      );
      child.stderr?.resume();
      child.stdin?.on('error', () => undefined);
      exited = new Promise((complete) => {
        child!.once('error', () => complete(-1));
        child!.once('close', (code) => complete(code ?? -1));
      });
      await once(child, 'spawn').catch(() => {
        throw new Error('recordUnavailable');
      });
      state('recording', 'recording');
      void exited
        .then(async (code) => {
          clearTimeout(killTimer);
          if (settled || signal.aborted) return;
          ready = true;
          const size = await stat(file).then(
            (value) => value.size,
            () => 0,
          );
          state('ready', code !== 0 || !size ? 'recordFailed' : stopped ? 'recordReady' : 'recordLimit');
        })
        .catch(() => state('ready', 'recordFailed'));
    }
    return await done;
  } finally {
    unsubscribe();
    signal.removeEventListener('abort', abort);
    await stop();
    clearTimeout(killTimer);
  }
}

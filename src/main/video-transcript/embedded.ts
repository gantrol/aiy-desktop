import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import type { VideoDocumentTranscriptCue } from '@/shared/contracts';
import type { LibraryDatabase } from '@/main/database';
import { parseSrt } from '@/main/video-transcript/srt';

const maximumSubtitleBytes = 8 * 1024 * 1024;
const extractionTimeoutMs = 60_000;

export interface EmbeddedTimedSubtitles {
  sourceFileName: string;
  rawText: string;
  cues: VideoDocumentTranscriptCue[];
}

type EmbeddedSubtitleDatabase = Pick<LibraryDatabase, 'getVideoDocument' | 'resolveAssetFile'>;

function ffmpegExecutable() {
  const configured = process.env.AIY_FFMPEG_PATH?.trim();
  if (configured) return configured;
  const executable = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const bundled = process.resourcesPath ? path.join(process.resourcesPath, 'ffmpeg', executable) : null;
  try {
    if (bundled && statSync(bundled).isFile()) return bundled;
  } catch {
    // Development resolves FFmpeg from PATH.
  }
  return executable;
}

export async function extractEmbeddedTimedSubtitles(
  database: EmbeddedSubtitleDatabase,
  documentId: string,
): Promise<EmbeddedTimedSubtitles | null> {
  const document = database.getVideoDocument(documentId);
  if (!document.source.available) return null;
  const source = database.resolveAssetFile(document.source.asset.id);
  if (!source || !source.mimeType.startsWith('video/')) return null;

  const child = spawn(
    ffmpegExecutable(),
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-i',
      source.absolutePath,
      '-map',
      '0:s:0',
      '-vn',
      '-an',
      '-c:s',
      'srt',
      '-f',
      'srt',
      'pipe:1',
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const stdout: Buffer[] = [];
  let stdoutBytes = 0;
  let exceeded = false;
  child.stdout.on('data', (chunk: Buffer) => {
    if (exceeded) return;
    stdoutBytes += chunk.length;
    if (stdoutBytes > maximumSubtitleBytes) {
      exceeded = true;
      child.kill();
      return;
    }
    stdout.push(chunk);
  });
  child.stderr.resume();

  const completed = await new Promise<boolean>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve(false);
    }, extractionTimeoutMs);
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(success);
    };
    child.once('error', () => finish(false));
    child.once('close', (code) => finish(code === 0 && !exceeded));
  });
  if (!completed || !stdoutBytes) return null;

  const rawText = Buffer.concat(stdout, stdoutBytes).toString('utf8');
  try {
    return {
      sourceFileName: `${document.source.displayName || document.title} [subtitle:0]`,
      rawText,
      cues: parseSrt(rawText),
    };
  } catch {
    return null;
  }
}

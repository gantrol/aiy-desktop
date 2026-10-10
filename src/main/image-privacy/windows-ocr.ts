import { spawn } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';
import script from '@/main/image-privacy/windows-ocr.ps1?raw';

const wordSchema = z.object({
  text: z.string().max(1000),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});
const resultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('ready'),
      angle: z.number().finite().min(-180).max(180),
      lines: z
        .array(z.object({ words: z.array(wordSchema).max(10000), text: z.string().max(262144).optional() }))
        .max(10000),
    })
    .refine((value) => value.lines.reduce((count, line) => count + line.words.length, 0) <= 10000),
  z.object({ status: z.enum(['unavailable', 'tooLarge', 'failed', 'cancelled']) }),
]);
export type OcrWord = z.infer<typeof wordSchema>;
export type OcrResult = z.infer<typeof resultSchema>;

/** A short-lived, network-free helper. Pixels enter stdin; nothing is written to disk. */
export function recognizeWindowsImage(bytes: Uint8Array, signal: AbortSignal): Promise<OcrResult> {
  if (signal.aborted) return Promise.resolve({ status: 'cancelled' });
  return new Promise((resolve) => {
    const child = spawn(
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, stdio: 'pipe' },
    );
    let settled = false,
      output = '',
      size = 0;
    const finish = (result: OcrResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
      child.stdin.destroy();
      if (child.exitCode === null) child.kill();
      output = '';
      resolve(result);
    };
    const cancel = () => finish({ status: 'cancelled' });
    const timeout = setTimeout(() => finish({ status: 'failed' }), 30_000);
    signal.addEventListener('abort', cancel, { once: true });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (settled) return;
      size += Buffer.byteLength(chunk);
      if (size > 2 * 1024 * 1024) finish({ status: 'tooLarge' });
      else output += chunk;
    });
    child.stderr.resume();
    // The helper may reject an unsupported image before reading all input. Its response wins over EPIPE.
    child.stdin.on('error', () => undefined);
    child.once('error', () => finish({ status: 'unavailable' }));
    child.once('close', () => {
      if (settled) return;
      try {
        finish(resultSchema.parse(JSON.parse(output)));
      } catch {
        finish({ status: 'failed' });
      }
    });
    child.stdin.end(`${Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')}\n`);
  });
}

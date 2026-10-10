import { spawn } from 'node:child_process';

const FRAME_BYTES = 640 * 640 * 3;
const FORMATS = 'mov,matroska,webm,avi,mpeg,mpegts,ogg,flv';

/** Runs only in the isolated search worker. Output, runtime and decoder threads are bounded. */
async function execute(executable: string, args: string[], maxBytes: number, checkCancelled: () => void) {
  checkCancelled();
  return new Promise<{ output: Buffer; diagnostics: string }>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let diagnostics = '';
    let failure: Error | undefined;
    const fail = (error: Error) => {
      failure ??= error;
      child.kill();
    };
    const timer = setTimeout(() => fail(new Error('UNAVAILABLE')), 30_000);
    const cancellation = setInterval(() => {
      try {
        checkCancelled();
      } catch {
        fail(new Error('CANCELLED'));
      }
    }, 40);
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) fail(new Error('UNAVAILABLE'));
      else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (diagnostics.length + chunk.length > 128_000) fail(new Error('UNAVAILABLE'));
      else diagnostics += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      failure = error;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      clearInterval(cancellation);
      if (failure || code !== 0) reject(failure ?? new Error('UNAVAILABLE'));
      else resolve({ output: Buffer.concat(chunks), diagnostics });
    });
  });
}

export async function probeVideo(executable: string, file: string, checkCancelled: () => void) {
  const { output } = await execute(
    executable,
    [
      '-v',
      'error',
      '-protocol_whitelist',
      'file,pipe',
      '-format_whitelist',
      FORMATS,
      '-select_streams',
      'v:0',
      '-show_entries',
      'format=start_time,duration:stream=width,height',
      '-of',
      'json',
      file,
    ],
    32_000,
    checkCancelled,
  );
  const data = JSON.parse(output.toString('utf8')) as {
    format?: { start_time?: string; duration?: string };
    streams?: { width: number; height: number }[];
  };
  const stream = data.streams?.[0];
  const origin = Number(data.format?.start_time ?? 0);
  const durationMs = Math.round(Number(data.format?.duration) * 1000);
  if (
    !stream ||
    !Number.isInteger(stream.width) ||
    !Number.isInteger(stream.height) ||
    stream.width <= 0 ||
    stream.height <= 0 ||
    stream.width * stream.height > 16_000_000 ||
    !Number.isFinite(origin) ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  )
    throw new Error('UNAVAILABLE');
  return { origin, durationMs };
}

/** Keep source PTS: select real frames on a 250 ms grid; never synthesize timestamps with fps. */
export async function decodeVideoWindow(
  executable: string,
  file: string,
  startMs: number,
  origin: number,
  checkCancelled: () => void,
) {
  const end = origin + (startMs + 1000) / 1000;
  const filter = `trim=end=${end},select='isnan(prev_selected_t)+gt(floor((t-(${origin}))*4),floor((prev_selected_t-(${origin}))*4))',showinfo,scale=640:640:force_original_aspect_ratio=decrease,pad=640:640:(ow-iw)/2:(oh-ih)/2,setsar=1`;
  const { output, diagnostics } = await execute(
    executable,
    [
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'info',
      '-threads',
      '2',
      '-filter_threads',
      '1',
      '-protocol_whitelist',
      'file,pipe',
      '-format_whitelist',
      FORMATS,
      '-copyts',
      '-ss',
      String(startMs / 1000),
      '-i',
      file,
      '-map',
      '0:v:0',
      '-an',
      '-sn',
      '-dn',
      '-vf',
      filter,
      '-frames:v',
      '4',
      '-fps_mode',
      'passthrough',
      '-threads',
      '1',
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    FRAME_BYTES * 4,
    checkCancelled,
  );
  const base = /config in time_base:\s*(\d+)\/(\d+)/.exec(diagnostics);
  const pts = [...diagnostics.matchAll(/\bn:\s*\d+\s+pts:\s*(-?\d+)\s+pts_time:/g)].map((match) => Number(match[1]));
  const count = output.length / FRAME_BYTES;
  if (!count) return [];
  if (!base || !Number.isInteger(count) || count > 4 || pts.length < count) throw new Error('UNAVAILABLE');
  return Array.from({ length: count }, (_, index) => {
    const sourcePts = pts[index]!;
    if (!Number.isSafeInteger(sourcePts)) throw new Error('UNAVAILABLE');
    const timestampMs = Math.max(0, Math.round(((sourcePts * Number(base[1])) / Number(base[2]) - origin) * 1000));
    return {
      sourcePts: String(sourcePts),
      timeBase: `${base[1]}/${base[2]}`,
      timestampMs,
      pixels: output.subarray(index * FRAME_BYTES, (index + 1) * FRAME_BYTES),
    };
  });
}

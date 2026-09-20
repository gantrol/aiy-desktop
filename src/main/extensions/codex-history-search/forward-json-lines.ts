import { open } from 'node:fs/promises';

const CHUNK_BYTES = 256 * 1024;
const MAX_RECORD_BYTES = 16 * 1024 * 1024;
const MAX_PAGE_BYTES = 64 * 1024 * 1024;

export interface ForwardScanState {
  exhausted: boolean;
  scanLimited: boolean;
  continuationCursor: number;
}

/** Starts at a known message boundary; buffers only one bounded JSONL record. */
export async function* forwardJsonLines(
  filePath: string,
  start: number,
  state: ForwardScanState,
  signal: AbortSignal,
): AsyncGenerator<{ line: Buffer; start: number }> {
  const handle = await open(filePath, 'r');
  try {
    const metadata = await handle.stat({ bigint: true });
    if (metadata.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Codex task history file is too large');
    const size = Number(metadata.size);
    let position = Math.min(start, size);
    let lineStart = position;
    let carry = Buffer.alloc(0);
    let discarding = false;
    let bytesRead = 0;
    while (position < size && bytesRead < MAX_PAGE_BYTES) {
      signal.throwIfAborted();
      const buffer = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, size - position, MAX_PAGE_BYTES - bytesRead));
      const read = await handle.read(buffer, 0, buffer.length, position);
      if (!read.bytesRead) break;
      position += read.bytesRead;
      bytesRead += read.bytesRead;
      const combined = Buffer.concat([carry, buffer.subarray(0, read.bytesRead)]);
      let offset = 0;
      for (let end = combined.indexOf(0x0a); end >= 0; end = combined.indexOf(0x0a, offset)) {
        let line = combined.subarray(offset, end);
        const recordStart = lineStart;
        lineStart += end - offset + 1;
        state.continuationCursor = lineStart;
        offset = end + 1;
        if (discarding || line.length > MAX_RECORD_BYTES) {
          state.scanLimited = true;
          discarding = false;
          continue;
        }
        if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
        if (line.length) yield { line, start: recordStart };
      }
      carry = Buffer.from(combined.subarray(offset));
      if (carry.length > MAX_RECORD_BYTES || discarding) {
        lineStart += carry.length;
        carry = Buffer.alloc(0);
        discarding = true;
        state.scanLimited = true;
      }
    }
    state.exhausted = position >= size;
    if (state.exhausted && !discarding && carry.length) {
      state.continuationCursor = size;
      yield { line: carry, start: lineStart };
    } else if (!state.exhausted) {
      // Resume at the incomplete record, so a page boundary never drops a message.
      state.continuationCursor = lineStart;
      state.scanLimited = true;
    }
  } finally {
    await handle.close();
  }
}

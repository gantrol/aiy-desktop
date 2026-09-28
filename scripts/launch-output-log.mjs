import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Writable } from 'node:stream';

/** One bounded, backpressured log for both child output streams, also shown in the terminal. */
export async function createLaunchOutputLog(applicationRoot, name) {
  const directory = path.join(applicationRoot, 'dev-logs');
  const current = path.join(directory, `${name}-current.log`);
  const previous = path.join(directory, `${name}-previous.log`);
  const limit = 4 * 1024 * 1024;
  let size = 0;
  let failed = false;
  await mkdir(directory, { recursive: true });
  size = await stat(current).then(
    (file) => file.size,
    (error) => {
      if (error.code === 'ENOENT') return 0;
      throw error;
    },
  );
  const log = new Writable({
    highWaterMark: 64 * 1024,
    write(chunk, _encoding, callback) {
      if (failed) {
        callback();
        return;
      }
      void (async () => {
        if (size + chunk.length > limit) {
          await rm(previous, { force: true });
          await rename(current, previous);
          size = 0;
        }
        await appendFile(current, chunk);
        size += chunk.length;
      })()
        .catch((error) => {
          failed = true;
          console.error('[launcher] Output log unavailable', error);
        })
        .finally(callback);
    },
  });
  log.write(`\n[launcher] ${new Date().toISOString()} pid=${process.pid}\n`);
  console.info(`[launcher] Output log: ${current}`);
  return {
    attach(child) {
      for (const [source, destination] of [
        [child.stdout, process.stdout],
        [child.stderr, process.stderr],
      ]) {
        // A detached terminal must not turn EPIPE into a launcher crash or stop file logging.
        destination.once('error', () => source.unpipe(destination));
        source.pipe(destination, { end: false });
      }
      child.stdout.pipe(log, { end: false });
      child.stderr.pipe(log, { end: false });
      // close follows exit and delivery of the final stdout/stderr chunks.
      child.once('close', (code, signal) => {
        log.end(`\n[launcher] ${new Date().toISOString()} exit=${code} signal=${signal ?? ''}\n`);
      });
    },
  };
}

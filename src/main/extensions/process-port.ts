/** Internal, host-owned entrypoints only; never exposed through renderer IPC. */
export function extensionProcessPort() {
  if (process.parentPort) {
    const port = process.parentPort;
    return {
      send: (message: unknown) => port.postMessage(message),
      listen: (receive: (message: unknown) => void) => port.on('message', (event) => receive(event.data)),
    };
  }
  if (!process.send) throw new Error('EXTENSION_PROCESS_REQUIRED');
  process.once('disconnect', () => process.exit(0));
  return {
    send: (message: unknown) => {
      if (!process.connected) return;
      process.send!(message as object, undefined, undefined, (error: Error | null) => {
        if (error) process.exit(1);
      });
    },
    listen: (receive: (message: unknown) => void) => process.on('message', receive),
  };
}

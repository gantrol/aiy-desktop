const { app } = require('electron');
const path = require('node:path');

const operation = process.argv[2];
const supportedOperations = new Set(['register', 'unregister']);
const scheme = 'aiy';
const applicationRoot = path.resolve(__dirname, '..');
const applicationArguments = [applicationRoot];

if (!supportedOperations.has(operation)) {
  console.error('[deep-link] Expected register or unregister.');
  app.exit(1);
} else if (process.platform !== 'win32') {
  console.error('[deep-link] Development protocol management is currently supported on Windows only.');
  app.exit(1);
} else {
  void app
    .whenReady()
    .then(() => {
      const succeeded =
        operation === 'register'
          ? app.setAsDefaultProtocolClient(scheme, process.execPath, applicationArguments)
          : app.removeAsDefaultProtocolClient(scheme, process.execPath, applicationArguments);
      if (!succeeded) {
        console.error(`[deep-link] Failed to ${operation} ${scheme}:// for the development runtime.`);
        app.exit(1);
        return;
      }
      console.log(`[deep-link] ${scheme}:// development handler ${operation}ed.`);
      app.exit(0);
    })
    .catch((error) => {
      console.error(`[deep-link] Failed to ${operation} the development handler.`, error);
      app.exit(1);
    });
}

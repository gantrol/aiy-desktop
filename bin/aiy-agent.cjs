#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const entryPath = path.resolve(__dirname, '..', 'out', 'main', 'agent-cli.js');
if (!fs.existsSync(entryPath)) {
  process.stderr.write('AIY agent CLI is not built. Run npm run build first.\n');
  process.exitCode = 3;
} else {
  require(entryPath);
}

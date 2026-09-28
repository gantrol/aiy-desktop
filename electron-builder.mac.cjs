const { readFile } = require('node:fs/promises');
const path = require('node:path');
const yaml = require('js-yaml');

module.exports = async () => {
  if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) {
    throw new Error('Build the local macOS package on the matching Apple Silicon or Intel Mac.');
  }
  const config = yaml.load(await readFile(path.join(__dirname, 'electron-builder.yml'), 'utf8'));
  const nativeBinary = `prebuilds/darwin-${process.arch}.node`;
  config.directories.output = 'release/macos';
  config.files = config.files.map((entry) => {
    if (typeof entry === 'string' || entry.from !== 'node_modules/better-sqlite3') return entry;
    return {
      ...entry,
      filter: entry.filter.map((item) => (item === 'prebuilds/win32-x64.node' ? nativeBinary : item)),
    };
  });
  config.asarUnpack = config.asarUnpack.map((item) =>
    item === 'node_modules/better-sqlite3/prebuilds/win32-x64.node'
      ? `node_modules/better-sqlite3/${nativeBinary}`
      : item,
  );
  config.extraResources.push({
    from: `.tmp/native/darwin-${process.arch}/aiy-petal-input`,
    to: 'native/aiy-petal-input',
  });
  config.extraResources.push({ from: 'build/icon-mac.png', to: 'icon-mac.png' });
  delete config.win;
  config.mac = {
    target: [{ target: 'dmg', arch: [process.arch] }],
    icon: 'build/icon-mac.png',
    category: 'public.app-category.productivity',
    identity: '-',
    hardenedRuntime: false,
    notarize: false,
    artifactName: '${productName}-${version}-mac-${arch}.${ext}',
  };
  return config;
};

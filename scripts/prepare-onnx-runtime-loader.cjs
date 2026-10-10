const { readFile, mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');

// Adapt only the native load path. Retain the pinned upstream initialization code
// and copyright notice; fail closed when an ONNX update changes this contract.
module.exports = async () => {
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(await readFile(path.join(root, 'node_modules/onnxruntime-node/package.json'), 'utf8'));
  if (manifest.version !== '1.30.0') throw new Error('Review the pinned ONNX runtime before packaging.');
  const source = await readFile(path.join(root, 'node_modules/onnxruntime-node/dist/binding.js'), 'utf8');
  const lookup = 'require(`../bin/napi-v6/${process.platform}/${process.arch}/onnxruntime_binding.node`)';
  if (source.split(lookup).length !== 2) throw new Error('ONNX native binding loader changed.');
  const output = source.replace(
    lookup,
    'require(require("node:worker_threads").workerData?.nativeBindingPath ?? `../bin/napi-v6/${process.platform}/${process.arch}/onnxruntime_binding.node`)',
  );
  const directory = path.join(root, '.tmp/onnx-runtime-loader');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'binding.js'), output.replace(/\/\/# sourceMappingURL=.*$/m, ''));
};

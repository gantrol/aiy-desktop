import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';

const { stdout } = await promisify(execFile)('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
});
const repositoryFiles = stdout.split('\0').filter(Boolean);

const allowedTestAssets = [
  /^tests\/smoke\/startup-storage\.smoke\.test\.ts$/,
  /^vitest\.smoke\.config\.ts$/,
  /^playwright\.smoke\.config\.ts$/,
  /^scripts\/verify-public-smoke-boundary\.mjs$/,
];
const testAssetCandidates = [
  /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/,
  /(?:^|\/)(?:vitest|playwright)(?:\.[^/]*)?\.config\.[cm]?[jt]s$/,
  /^design-lab\/cross-entry\//,
  /^tests\//,
  /^e2e\//,
  /^bench\//,
  /^vitest.*\.ts$/,
  /^playwright(?:\..*)?\.config\.ts$/,
  /^scripts\/(?:generate-image-fixtures|manual-openai-image-acceptance)\.mjs$/,
  /^scripts\/verify-design-lab\.mjs$/,
];

const candidates = repositoryFiles.filter(
  (file) =>
    testAssetCandidates.some((pattern) => pattern.test(file)) &&
    !allowedTestAssets.some((pattern) => pattern.test(file)),
);
const disallowed = [];
for (const file of candidates) {
  if (file.toLowerCase().includes('trash')) {
    disallowed.push(file);
    continue;
  }
  try {
    await access(file);
    disallowed.push(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

if (disallowed.length > 0) {
  console.error('Public smoke boundary check failed.');
  process.exitCode = 1;
} else {
  console.log('Public smoke boundary check passed.');
}

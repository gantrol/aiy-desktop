import { execFileSync } from 'node:child_process';

const trackedFiles = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);

const allowedTestAssets = [
  /^tests\/smoke\//,
  /^e2e\/smoke\//,
  /^vitest\.smoke\.config\.ts$/,
  /^playwright\.smoke\.config\.ts$/,
  /^scripts\/verify-public-smoke-boundary\.mjs$/,
];
const testAssetCandidates = [
  /^tests\//,
  /^e2e\//,
  /^bench\//,
  /^vitest.*\.ts$/,
  /^playwright(?:\..*)?\.config\.ts$/,
  /^scripts\/(?:generate-image-fixtures|manual-openai-image-acceptance)\.mjs$/,
];

const disallowed = trackedFiles.filter(
  (file) =>
    testAssetCandidates.some((pattern) => pattern.test(file)) &&
    !allowedTestAssets.some((pattern) => pattern.test(file)),
);

if (disallowed.length > 0) {
  console.error('Public smoke boundary check failed.');
  process.exitCode = 1;
} else {
  console.log('Public smoke boundary check passed.');
}

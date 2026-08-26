import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const repositoryFiles = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .split('\0')
  .filter((file) => file && existsSync(file));

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

const disallowed = repositoryFiles.filter(
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

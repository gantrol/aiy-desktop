import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFileInfo } from 'prettier';

const desktopRoot = fileURLToPath(new URL('../', import.meta.url));
const repositoryRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: desktopRoot,
  encoding: 'utf8',
}).trim();
const prettierCli = fileURLToPath(new URL('../node_modules/prettier/bin/prettier.cjs', import.meta.url));
const eslintCli = fileURLToPath(new URL('../node_modules/eslint/bin/eslint.js', import.meta.url));
const lintableExtensions = new Set(['.cjs', '.js', '.mjs', '.ts', '.tsx']);

const touchedSourcePolicies = [
  {
    pattern: /^src\/renderer\/.*\.[jt]sx?$/,
    checks: [
      {
        pattern: /\.setContent\s*\(/,
        message:
          'Do not synchronize an external document into a live editor with commands.setContent; use an explicit editor session/load boundary.',
      },
      {
        pattern: /\.can\(\)\.chain\(\)\.(?:undo|redo)\(\)\.run\(\)/,
        message: 'Do not execute undo/redo to derive toolbar state; inspect history depth instead.',
      },
    ],
  },
  {
    pattern: /^src\/renderer\/features\/video-documents\/useVideoDocumentArticleAutosave\.ts$/,
    checks: [
      {
        pattern: /\[\s*draftMarkdown\s*,\s*setDraftMarkdown\s*\]\s*=\s*useState/,
        message:
          'Video article autosave must not keep a writable React Markdown copy; capture immutable persistence snapshots from the editor session.',
      },
    ],
  },
  {
    pattern: /^src\/renderer\/features\/video-documents\/VideoDocumentArticle\.tsx$/,
    checks: [
      {
        pattern: /sessionIdentity\s*=\s*\{[^\n]*revision\.id/,
        message: 'Persisted revision IDs must not be used as live editor session identities.',
      },
    ],
  },
];

function usage() {
  console.log('Usage: npm run verify:touched -- [--base <git-ref>]');
  console.log('Checks staged, unstaged, and untracked files. --base also includes changes from <git-ref>...HEAD.');
}

function parseArguments(arguments_) {
  let baseRef = null;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--help' || argument === '-h') return { help: true, baseRef: null };
    if (argument === '--base') {
      const value = arguments_[index + 1];
      if (!value) throw new Error('--base requires a Git ref.');
      baseRef = value;
      index += 1;
    } else if (argument.startsWith('--base=')) {
      baseRef = argument.slice('--base='.length);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (baseRef !== null && (!baseRef || baseRef.startsWith('-'))) {
    throw new Error('--base requires a Git ref that does not begin with "-".');
  }

  return { help: false, baseRef };
}

function gitOutput(arguments_) {
  return execFileSync('git', arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

function nulSeparatedGitPaths(arguments_) {
  return gitOutput(arguments_).split('\0').filter(Boolean);
}

function absolutePath(gitPath) {
  return resolve(repositoryRoot, ...gitPath.split('/'));
}

function existingTouchedFiles(baseRef) {
  const paths = new Set([
    ...nulSeparatedGitPaths(['diff', '--name-only', '-z', '--diff-filter=ACMRTU', '--']),
    ...nulSeparatedGitPaths(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMRTU', '--']),
    ...nulSeparatedGitPaths(['ls-files', '-z', '--others', '--exclude-standard']),
  ]);

  if (baseRef) {
    try {
      gitOutput(['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`]);
    } catch {
      throw new Error(`Cannot resolve --base Git ref: ${baseRef}`);
    }
    for (const path of nulSeparatedGitPaths([
      'diff',
      '--name-only',
      '-z',
      '--diff-filter=ACMRTU',
      `${baseRef}...HEAD`,
      '--',
    ])) {
      paths.add(path);
    }
  }

  return [...paths]
    .filter((path) => {
      const candidate = absolutePath(path);
      return existsSync(candidate) && statSync(candidate).isFile();
    })
    .sort((left, right) => left.localeCompare(right));
}

function fileChunks(files, maximumCharacters = 16_000) {
  const chunks = [];
  let current = [];
  let currentCharacters = 0;

  for (const file of files) {
    const addedCharacters = file.length + 3;
    if (current.length > 0 && currentCharacters + addedCharacters > maximumCharacters) {
      chunks.push(current);
      current = [];
      currentCharacters = 0;
    }
    current.push(file);
    currentCharacters += addedCharacters;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

function runNodeCli(cliPath, arguments_, files) {
  for (const chunk of fileChunks(files)) {
    const result = spawnSync(process.execPath, [cliPath, ...arguments_, ...chunk], {
      cwd: repositoryRoot,
      stdio: 'inherit',
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

async function prettierCandidates(files) {
  const ignorePath = resolve(repositoryRoot, '.prettierignore');
  const candidates = [];

  for (const file of files) {
    const information = await getFileInfo(absolutePath(file), {
      ignorePath: existsSync(ignorePath) ? ignorePath : undefined,
      withNodeModules: false,
    });
    if (!information.ignored && information.inferredParser) candidates.push(file);
  }

  return candidates;
}

function touchedSourcePolicyFailures(files) {
  const failures = [];
  for (const file of files) {
    const policies = touchedSourcePolicies.filter((policy) => policy.pattern.test(file));
    if (policies.length === 0) continue;
    const source = readFileSync(absolutePath(file), 'utf8');
    for (const policy of policies) {
      for (const check of policy.checks) {
        if (check.pattern.test(source)) failures.push(`${file}: ${check.message}`);
      }
    }
  }
  return failures;
}

async function main() {
  const { help, baseRef } = parseArguments(process.argv.slice(2));
  if (help) {
    usage();
    return;
  }

  const touchedFiles = existingTouchedFiles(baseRef);
  if (touchedFiles.length === 0) {
    console.log('[verify:touched] No staged, unstaged, untracked, or base-relative files to check.');
    return;
  }

  const formattedFiles = await prettierCandidates(touchedFiles);
  const lintedFiles = touchedFiles.filter((file) => lintableExtensions.has(extname(file).toLowerCase()));
  console.log(
    `[verify:touched] ${touchedFiles.length} touched file(s): ${formattedFiles.length} format candidate(s), ${lintedFiles.length} lint candidate(s).`,
  );

  const policyFailures = touchedSourcePolicyFailures(touchedFiles);
  if (policyFailures.length > 0) {
    console.error('[verify:touched] Touched-source ownership checks failed:');
    for (const failure of policyFailures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }

  if (formattedFiles.length > 0) {
    const prettierStatus = runNodeCli(prettierCli, ['--check'], formattedFiles);
    if (prettierStatus !== 0) {
      process.exitCode = prettierStatus;
      return;
    }
  }

  if (lintedFiles.length > 0) {
    const eslintStatus = runNodeCli(
      eslintCli,
      ['--cache', '--cache-location', '.tmp/eslint/', '--max-warnings', '0', '--no-warn-ignored'],
      lintedFiles,
    );
    if (eslintStatus !== 0) {
      process.exitCode = eslintStatus;
      return;
    }
  }

  console.log('[verify:touched] Touched-source ownership, formatting, and lint checks passed.');
}

main().catch((error) => {
  console.error(`[verify:touched] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

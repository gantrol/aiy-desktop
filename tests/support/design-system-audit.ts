import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export interface DesignSystemDiagnostic {
  rule: string;
  file: string;
  line: number;
  column: number;
  message: string;
}

const desktopRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const rendererRoot = path.join(desktopRoot, 'src', 'renderer');
const tokenFile = normalizePath(path.join(rendererRoot, 'styles', 'tokens.css'));

const fixedTailwindPalettePattern =
  /\b(?:bg|text|border|divide|outline|ring|ring-offset|shadow|fill|stroke|decoration|from|via|to)-(?:black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-(?:50|[1-9]00|950))?(?:\/(?:[0-9]{1,3}|\[[^\]]+\]))?\b/g;

const semanticTokens = [
  'background',
  'surface',
  'surface-sunken',
  'overlay',
  'foreground',
  'foreground-secondary',
  'muted-foreground',
  'disabled-foreground',
  'hover',
  'hover-strong',
  'pressed',
  'selected',
  'selected-foreground',
  'selected-border',
  'ring',
  'primary',
  'primary-foreground',
  'primary-hover',
  'border',
  'border-strong',
  'input',
  'success',
  'success-surface',
  'warning',
  'warning-surface',
  'info',
  'info-surface',
  'destructive',
  'destructive-foreground',
  'destructive-surface',
  'destructive-hover',
  'media-surround',
  'media-surround-light',
  'media-surround-dark',
  'media-checker-a',
  'media-checker-b',
  'dialog-scrim',
  'state-locked-fg',
  'state-locked-bg',
  'state-changed-fg',
  'state-changed-bg',
  'state-drift-fg',
  'generation-action',
  'generation-action-foreground',
  'generation-action-hover',
  'verdict-pass',
  'verdict-partial',
  'verdict-fail',
  'verdict-unrated',
  'lifecycle-draft',
  'lifecycle-approved',
  'lifecycle-archived',
  'lifecycle-published',
  'relation-favorited',
  'relation-referenced',
] as const;

function normalizePath(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}

function relativePath(filePath: string): string {
  return normalizePath(path.relative(desktopRoot, filePath));
}

function discoverRendererSources(directory: string): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return ['trash', '.tmp', 'dist', 'out', 'coverage'].includes(entry.name)
          ? []
          : discoverRendererSources(entryPath);
      }
      return /\.(?:css|ts|tsx)$/.test(entry.name) ? [entryPath] : [];
    });
}

let rendererSourceFiles: string[] | undefined;
const sourceCache = new Map<string, string>();
const searchableSourceCache = new Map<string, string>();

function listRendererSources(): string[] {
  rendererSourceFiles ??= discoverRendererSources(rendererRoot);
  return rendererSourceFiles;
}

function blankRange(buffer: string[], source: string, start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    if (source[index] !== '\n' && source[index] !== '\r') buffer[index] = ' ';
  }
}

function stripComments(source: string, filePath: string): string {
  const buffer = source.split('');
  if (filePath.endsWith('.css')) {
    for (const match of source.matchAll(/\/\*[\s\S]*?\*\//g)) {
      blankRange(buffer, source, match.index, match.index + match[0].length);
    }
    return buffer.join('');
  }

  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    filePath.endsWith('.tsx') ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
    source,
  );
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) {
      blankRange(buffer, source, scanner.getTokenPos(), scanner.getTextPos());
    }
  }
  return buffer.join('');
}

function readSource(filePath: string): string {
  let source = sourceCache.get(filePath);
  if (source === undefined) {
    source = fs.readFileSync(filePath, 'utf8');
    sourceCache.set(filePath, source);
  }
  return source;
}

function readSearchableSource(filePath: string): string {
  let source = searchableSourceCache.get(filePath);
  if (source === undefined) {
    source = stripComments(readSource(filePath), filePath);
    searchableSourceCache.set(filePath, source);
  }
  return source;
}

function sourcePosition(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, offset);
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function regexDiagnostics(
  rule: string,
  pattern: RegExp,
  message: string,
  except: (filePath: string) => boolean,
): DesignSystemDiagnostic[] {
  const diagnostics: DesignSystemDiagnostic[] = [];
  for (const filePath of listRendererSources()) {
    const normalized = normalizePath(filePath);
    if (except(normalized)) continue;
    const source = readSource(filePath);
    const searchable = readSearchableSource(filePath);
    for (const match of searchable.matchAll(pattern)) {
      const position = sourcePosition(source, match.index ?? 0);
      diagnostics.push({ rule, file: relativePath(filePath), ...position, message });
    }
  }
  return diagnostics;
}

function hoverTransformDiagnostics(): DesignSystemDiagnostic[] {
  const diagnostics: DesignSystemDiagnostic[] = [];
  const pattern =
    /\b(?:(?:group-)?hover:(?:-?translate-[xy]?-[^\s"'`]+|scale-[^\s"'`]+)|group-hover\/[a-z0-9_-]+:scale-[^\s"'`]+)/gi;
  for (const filePath of listRendererSources()) {
    const source = readSource(filePath);
    const searchable = readSearchableSource(filePath);
    for (const match of searchable.matchAll(pattern)) {
      const start = match.index ?? 0;
      const lineStart = source.lastIndexOf('\n', start) + 1;
      const lineEnd = source.indexOf('\n', start);
      const line = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
      const allowedMediaInspectionZoom =
        match[0].endsWith('scale-[1.015]') &&
        line.includes('object-contain') &&
        line.includes('motion-reduce:transform-none');
      if (allowedMediaInspectionZoom) continue;
      diagnostics.push({
        rule: 'DS102',
        file: relativePath(filePath),
        ...sourcePosition(source, start),
        message:
          'Persistent workbench containers may not lift or scale on hover; only the contracted media inspection zoom is allowed.',
      });
    }
  }
  return diagnostics;
}

function fileRegexDiagnostics(
  rule: string,
  filePath: string,
  pattern: RegExp,
  message: string,
): DesignSystemDiagnostic[] {
  const source = readSource(filePath);
  const searchable = readSearchableSource(filePath);
  return [...searchable.matchAll(pattern)].map((match) => ({
    rule,
    file: relativePath(filePath),
    ...sourcePosition(source, match.index ?? 0),
    message,
  }));
}

function requiredUtilityDiagnostics(
  rule: string,
  filePath: string,
  requirements: ReadonlyArray<readonly [utility: string, minimumCount: number]>,
): DesignSystemDiagnostic[] {
  const source = readSearchableSource(filePath);
  return requirements.flatMap(([utility, minimumCount]) => {
    const count = source.split(utility).length - 1;
    return count >= minimumCount
      ? []
      : [
          structuralDiagnostic(
            rule,
            relativePath(filePath),
            `${relativePath(filePath)} must use ${utility} at least ${minimumCount} time(s).`,
          ),
        ];
  });
}

function structuralDiagnostic(rule: string, file: string, message: string): DesignSystemDiagnostic {
  return { rule, file, line: 1, column: 1, message };
}

export function auditRawColors(): DesignSystemDiagnostic[] {
  const exception = (filePath: string) => filePath === tokenFile;
  return [
    ...regexDiagnostics('DS001', /#[0-9a-f]{3,8}\b/gi, 'Raw hex colors belong in styles/tokens.css.', exception),
    ...regexDiagnostics(
      'DS001',
      /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\s*\(/gi,
      'Raw color functions belong in styles/tokens.css.',
      exception,
    ),
    ...auditFixedTailwindPaletteColors(),
  ];
}

export function findFixedTailwindPaletteUtilities(source: string): string[] {
  return [...source.matchAll(fixedTailwindPalettePattern)].map((match) => match[0]);
}

export function auditFixedTailwindPaletteColors(): DesignSystemDiagnostic[] {
  const diagnostics: DesignSystemDiagnostic[] = [];
  for (const filePath of listRendererSources()) {
    const source = readSource(filePath);
    const searchable = readSearchableSource(filePath);
    const relative = relativePath(filePath);
    for (const match of searchable.matchAll(fixedTailwindPalettePattern)) {
      const utility = match[0];
      diagnostics.push({
        rule: 'DS001',
        file: relative,
        ...sourcePosition(source, match.index ?? 0),
        message: `Fixed Tailwind palette utility ${utility} must be replaced with an L2 or L3 token.`,
      });
    }
  }
  return diagnostics;
}

export function auditL1Consumption(): DesignSystemDiagnostic[] {
  return regexDiagnostics(
    'DS002',
    /--(?:sand|plum|red|amber|green|blue|neutral)-[0-9]+\b/gi,
    'Renderer code may consume only L2 or L3 design tokens.',
    (filePath) => filePath === tokenFile,
  );
}

export function auditP1InteractionContracts(): DesignSystemDiagnostic[] {
  const segmentedFile = normalizePath(path.join(rendererRoot, 'components', 'ui', 'segmented.tsx'));
  const sidebarFile = normalizePath(path.join(rendererRoot, 'components', 'app', 'AppSidebar.tsx'));
  const uiDirectory = path.join(rendererRoot, 'components', 'ui');
  const dialogFile = path.join(uiDirectory, 'dialog.tsx');
  const hoverCardFile = path.join(uiDirectory, 'hover-card.tsx');
  const tooltipFile = path.join(uiDirectory, 'tooltip.tsx');
  const contextMenuFile = path.join(uiDirectory, 'context-menu.tsx');
  const popoverFile = path.join(uiDirectory, 'popover.tsx');
  const selectFile = path.join(uiDirectory, 'select.tsx');
  const labelFile = path.join(uiDirectory, 'label.tsx');
  const buttonFile = path.join(uiDirectory, 'button.tsx');
  const forbiddenE3Utilities =
    /\b(?:bg-popover|text-popover-foreground|bg-accent|text-accent-foreground|bg-black(?:\/[0-9]+)?|shadow-(?:xs|sm|md|lg|xl|2xl))\b/g;
  return [
    ...regexDiagnostics(
      'DS100',
      /\bshadow-(?:xs|sm|md|lg|xl|2xl)\b/g,
      'Use the semantic shadow-overlay or shadow-dialog token; persistent UI must remain flat.',
      () => false,
    ),
    ...hoverTransformDiagnostics(),
    ...regexDiagnostics(
      'DS103',
      /\bobject-cover\b/g,
      'Workbench media must preserve its full source frame with object-contain.',
      () => false,
    ),
    ...regexDiagnostics(
      'DS104',
      /\bfocus-visible:ring-0\b/g,
      'Interactive controls may not suppress the visible focus ring.',
      () => false,
    ),
    ...regexDiagnostics(
      'DS101',
      /\bshadow-(?:xs|sm|md|lg|xl|2xl)\b/g,
      'Segmented controls and persistent navigation may not use elevation.',
      (filePath) => filePath !== segmentedFile && filePath !== sidebarFile,
    ),
    ...regexDiagnostics(
      'DS104',
      /\b(?:focus-visible|focus-within):ring-ring\/(?:20|30|40|50|60)\b|\boutline-ring\/(?:20|30|40|50|60)\b/g,
      'Focus indicators must use an opaque ring token.',
      () => false,
    ),
    ...regexDiagnostics(
      'DS105',
      /\b(?:Spark(?:le|les)?(?:Icon)?|Wand(?:Sparkles)?(?:Icon)?|Bot(?:Icon)?|Brain(?:Icon)?|Stars(?:Icon)?)\b/g,
      'Decorative AI and magic icons are not part of the workbench icon language.',
      () => false,
    ),
    ...[dialogFile, hoverCardFile, tooltipFile, contextMenuFile, popoverFile, selectFile].flatMap((filePath) =>
      fileRegexDiagnostics(
        'DS106',
        filePath,
        forbiddenE3Utilities,
        'E3/E4 primitives must use semantic surfaces and elevation tokens.',
      ),
    ),
    ...requiredUtilityDiagnostics('DS106', dialogFile, [
      ['bg-dialog-scrim', 1],
      ['bg-overlay', 1],
      ['shadow-dialog', 1],
      ['focus-visible:ring-ring', 1],
    ]),
    ...requiredUtilityDiagnostics('DS106', hoverCardFile, [
      ['border-border', 1],
      ['bg-overlay', 1],
      ['text-foreground', 1],
      ['shadow-overlay', 1],
    ]),
    ...requiredUtilityDiagnostics('DS106', tooltipFile, [
      ['border-border', 1],
      ['bg-overlay', 1],
      ['text-foreground', 1],
      ['shadow-overlay', 1],
    ]),
    ...requiredUtilityDiagnostics('DS106', contextMenuFile, [
      ['border-border', 2],
      ['bg-overlay', 2],
      ['text-foreground', 4],
      ['shadow-overlay', 2],
      ['focus-visible:ring-ring', 4],
      ['data-[disabled]:text-disabled-foreground', 4],
    ]),
    ...requiredUtilityDiagnostics('DS106', popoverFile, [
      ['bg-overlay', 1],
      ['text-foreground', 1],
      ['shadow-overlay', 1],
    ]),
    ...requiredUtilityDiagnostics('DS106', selectFile, [
      ['h-9', 1],
      ['text-sm', 1],
      ['border-border', 1],
      ['bg-overlay', 1],
      ['shadow-overlay', 1],
    ]),
    ...requiredUtilityDiagnostics('DS107', labelFile, [['peer-disabled:text-disabled-foreground', 1]]),
    ...requiredUtilityDiagnostics('DS107', buttonFile, [
      ['before:-inset-y-0.5', 1],
      ["before:content-['']", 1],
    ]),
    ...fileRegexDiagnostics(
      'DS107',
      contextMenuFile,
      /\bfocus:(?!visible)|data-\[disabled\]:opacity-50\b/g,
      'Menu focus and disabled states must use the focus-visible ring and disabled foreground token.',
    ),
    ...fileRegexDiagnostics(
      'DS107',
      labelFile,
      /peer-disabled:opacity-[0-9]+\b/g,
      'Disabled labels must use --disabled-foreground rather than opacity.',
    ),
  ];
}

export function auditTokenArchitecture(): DesignSystemDiagnostic[] {
  const diagnostics: DesignSystemDiagnostic[] = [];
  const stylesDirectory = path.join(rendererRoot, 'styles');
  const expectedFiles = ['tokens.css', 'base.css', 'index.css'];
  for (const name of expectedFiles) {
    const filePath = path.join(stylesDirectory, name);
    if (!fs.existsSync(filePath))
      diagnostics.push(
        structuralDiagnostic('DS003', relativePath(filePath), 'Required design-system file is missing.'),
      );
  }

  const legacyStyles = path.join(rendererRoot, 'styles.css');
  if (fs.existsSync(legacyStyles))
    diagnostics.push(structuralDiagnostic('DS003', relativePath(legacyStyles), 'Legacy styles.css must stay removed.'));

  const indexPath = path.join(stylesDirectory, 'index.css');
  if (fs.existsSync(indexPath)) {
    const imports = readSearchableSource(indexPath)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const importTargets = imports.map((line) => line.match(/^@import\s+(['"])([^'"]+)\1;$/)?.[2] ?? `INVALID:${line}`);
    const expectedImportTargets = ['tailwindcss', './tokens.css', './base.css'];
    if (importTargets.join('\n') !== expectedImportTargets.join('\n')) {
      diagnostics.push(
        structuralDiagnostic(
          'DS003',
          relativePath(indexPath),
          'styles/index.css must import Tailwind, tokens, and base exactly once in that order.',
        ),
      );
    }
  }

  const tokensPath = path.join(stylesDirectory, 'tokens.css');
  if (fs.existsSync(tokensPath)) {
    const source = readSearchableSource(tokensPath);
    const rootBlock = source.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const darkBlock = source.match(/\[data-theme=["']dark["']\]\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    if (!rootBlock)
      diagnostics.push(
        structuralDiagnostic('DS003', relativePath(tokensPath), 'tokens.css must define a :root token scope.'),
      );
    if (!darkBlock)
      diagnostics.push(
        structuralDiagnostic('DS003', relativePath(tokensPath), 'tokens.css must define a dark structural scope.'),
      );
    for (const token of semanticTokens) {
      const declaration = new RegExp(`--${token}\\s*:`);
      if (!declaration.test(rootBlock))
        diagnostics.push(structuralDiagnostic('DS003', relativePath(tokensPath), `Light scope is missing --${token}.`));
      if (!declaration.test(darkBlock))
        diagnostics.push(structuralDiagnostic('DS003', relativePath(tokensPath), `Dark scope is missing --${token}.`));
    }
  }

  const rendererEntry = path.join(rendererRoot, 'index.tsx');
  const rendererSource = readSource(rendererEntry);
  if (!rendererSource.includes("import './styles/index.css';") || rendererSource.includes("import './styles.css';")) {
    diagnostics.push(
      structuralDiagnostic('DS003', relativePath(rendererEntry), 'Renderer entry must import styles/index.css only.'),
    );
  }

  const shadcnPath = path.join(desktopRoot, 'components.json');
  const shadcn = JSON.parse(fs.readFileSync(shadcnPath, 'utf8')) as { tailwind?: { css?: string } };
  if (shadcn.tailwind?.css !== 'src/renderer/styles/index.css') {
    diagnostics.push(
      structuralDiagnostic('DS003', relativePath(shadcnPath), 'shadcn must target the design-system CSS entry.'),
    );
  }

  const runtimeBridge = path.join(rendererRoot, 'lib', 'tokens.ts');
  if (!fs.existsSync(runtimeBridge)) {
    diagnostics.push(structuralDiagnostic('DS004', relativePath(runtimeBridge), 'Runtime token bridge is missing.'));
  } else {
    const source = readSearchableSource(runtimeBridge);
    if (!source.includes('getComputedStyle') || !source.includes('getPropertyValue')) {
      diagnostics.push(
        structuralDiagnostic(
          'DS004',
          relativePath(runtimeBridge),
          'Runtime token bridge must read computed CSS custom properties.',
        ),
      );
    }
  }

  return diagnostics;
}

export function formatDiagnostics(diagnostics: DesignSystemDiagnostic[]): string[] {
  return [...diagnostics]
    .sort(
      (left, right) =>
        left.file.localeCompare(right.file) ||
        left.line - right.line ||
        left.column - right.column ||
        left.rule.localeCompare(right.rule),
    )
    .map(({ rule, file, line, column, message }) => `${file}:${line}:${column} [${rule}] ${message}`);
}

export function readTokenSource(): string {
  return readSource(path.join(rendererRoot, 'styles', 'tokens.css'));
}

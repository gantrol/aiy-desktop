import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.join(workspaceRoot, 'src');
const sourceExtensions = new Set(['.ts', '.tsx']);
const resourceImport = /\.(?:css|scss|sass|less|svg|png|jpe?g|webp|gif|woff2?|json|sql)(?:\?.*)?$/i;

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filePath);
    return entry.isFile() && sourceExtensions.has(path.extname(entry.name)) ? [filePath] : [];
  });
}

function moduleSpecifier(node) {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
    return ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier : null;
  }
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments.length === 1 &&
    ts.isStringLiteral(node.arguments[0])
  ) {
    return node.arguments[0];
  }
  return null;
}

function aliasFor(filePath, specifier) {
  if (!specifier.startsWith('.') || resourceImport.test(specifier)) return null;
  const queryIndex = specifier.indexOf('?');
  const modulePath = queryIndex < 0 ? specifier : specifier.slice(0, queryIndex);
  const query = queryIndex < 0 ? '' : specifier.slice(queryIndex);
  const absoluteTarget = path.resolve(path.dirname(filePath), modulePath);
  const relativeTarget = path.relative(sourceRoot, absoluteTarget);
  if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
    throw new Error(`Source import escapes src/: ${path.relative(workspaceRoot, filePath)} -> ${specifier}`);
  }
  return `@/${relativeTarget.replaceAll(path.sep, '/')}${query}`;
}

let changedFiles = 0;
let changedImports = 0;
for (const filePath of sourceFiles(sourceRoot)) {
  const sourceText = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const edits = [];
  const visit = (node) => {
    const specifierNode = moduleSpecifier(node);
    if (specifierNode) {
      const replacement = aliasFor(filePath, specifierNode.text);
      if (replacement && replacement !== specifierNode.text) {
        edits.push({ start: specifierNode.getStart(sourceFile) + 1, end: specifierNode.getEnd() - 1, replacement });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!edits.length) continue;
  let migrated = sourceText;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    migrated = `${migrated.slice(0, edit.start)}${edit.replacement}${migrated.slice(edit.end)}`;
  }
  writeFileSync(filePath, migrated, 'utf8');
  changedFiles += 1;
  changedImports += edits.length;
}

console.log(`Migrated ${changedImports} imports in ${changedFiles} source files.`);

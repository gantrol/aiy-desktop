import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

type JsonMap = Record<string, unknown>;

export interface DictionaryImportReadOptions {
  rootPath?: string;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxFiles?: number;
}

interface DictionaryImportReadState {
  rootPath: string;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
  totalBytes: number;
  cache: Map<string, JsonMap[]>;
  active: Set<string>;
}

const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_FILES = 10_000;
const MAX_NESTING_DEPTH = 32;

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

function requiredMap(value: unknown, label: string): JsonMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as JsonMap;
}

const stringList = (value: unknown) => {
  if (Array.isArray(value))
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  return text(value)
    .split(/[;|、]/)
    .map((item) => item.trim())
    .filter(Boolean);
};

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const source = text(value);
  if (!source) return [];
  try {
    const parsed = JSON.parse(source) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell);
      cell = '';
      if (row.some((item) => item.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (quoted) throw new Error('Dictionary CSV contains an unterminated quoted field');
  row.push(cell);
  if (row.some((item) => item.trim())) rows.push(row);
  return rows;
}

function normalizeLocalization(value: unknown): JsonMap | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as JsonMap;
  const locale = text(row.locale);
  const title = text(row.title);
  if (!locale || !title) return null;
  return {
    locale,
    title,
    definition: text(row.definition),
    aliases: stringList(row.aliases),
  };
}

function normalizeExpression(value: unknown): JsonMap | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as JsonMap;
  const contextKey = text(row.contextKey);
  const modelKey = text(row.modelKey);
  const locale = text(row.locale);
  const positive = text(row.positive);
  const negative = text(row.negative);
  if (!modelKey || !locale || (!positive && !negative)) return null;
  if (!contextKey) throw new Error('Each dictionary expression needs a contextKey');
  return { contextKey, modelKey, locale, positive, negative };
}

function normalizeTerm(row: JsonMap): JsonMap {
  const localizations = parseJsonArray(row.localizations)
    .map(normalizeLocalization)
    .filter((item): item is JsonMap => item !== null);
  const expressions = parseJsonArray(row.expressions)
    .map(normalizeExpression)
    .filter((item): item is JsonMap => item !== null);
  const modelKey = text(row.modelKey);
  const expressionContextKey = text(row.expressionContextKey);
  const expressionLocale = text(row.expressionLocale);
  const positive = text(row.positive);
  const negative = text(row.negative);
  if (modelKey && expressionLocale && (positive || negative)) {
    if (!expressionContextKey) throw new Error('Flat dictionary expressions need expressionContextKey');
    expressions.push({ contextKey: expressionContextKey, modelKey, locale: expressionLocale, positive, negative });
  }
  return {
    ...Object.fromEntries(
      ['id', 'revisionId', 'revisionNo', 'editorialState'].flatMap((key) =>
        row[key] === undefined ? [] : [[key, row[key]]],
      ),
    ),
    stableKey: text(row.stableKey || row.stable_key),
    title: text(row.title),
    titleLocale: text(row.titleLocale || row.title_locale),
    definition: text(row.definition),
    aliases: stringList(row.aliases),
    localizations,
    classificationKeys: stringList(row.classificationKeys || row.classification_keys),
    primaryDirectoryClassificationKey: text(
      row.primaryDirectoryClassificationKey || row.primary_directory_classification_key,
    ),
    expressions,
  };
}

function fromDictionaryCore(source: JsonMap): JsonMap[] {
  const terms = Array.isArray(source.terms) ? source.terms.map((term) => requiredMap(term, 'Dictionary term')) : [];
  const retiredTermIds = new Set(Array.isArray(source.retiredTermIds) ? source.retiredTermIds : []);
  return terms.filter((term) => !retiredTermIds.has(term.id)).map(normalizeTerm);
}

function contained(rootPath: string, candidatePath: string) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function readDictionaryImportFile(filePath: string, state: DictionaryImportReadState, depth: number): JsonMap[] {
  if (depth > MAX_NESTING_DEPTH) throw new Error('Dictionary import nesting is too deep');
  if (path.isAbsolute(filePath) && !contained(state.rootPath, path.resolve(filePath))) {
    throw new Error('Dictionary import references a file outside its root');
  }
  const resolvedPath = path.resolve(filePath);
  const entry = lstatSync(resolvedPath);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Dictionary import source must be a regular file');
  const realPath = realpathSync(resolvedPath);
  if (!contained(state.rootPath, realPath)) throw new Error('Dictionary import references a file outside its root');
  const cached = state.cache.get(realPath);
  if (cached) return cached;
  if (state.active.has(realPath)) throw new Error('Dictionary import contains a recursive file reference');
  if (state.cache.size + state.active.size >= state.maxFiles) {
    throw new Error('Dictionary import contains too many files');
  }
  if (entry.size <= 0 || entry.size > state.maxFileBytes || state.totalBytes + entry.size > state.maxTotalBytes) {
    throw new Error('Dictionary import exceeds its file-size budget');
  }
  state.active.add(realPath);
  try {
    const bytes = readFileSync(realPath);
    if (bytes.byteLength > state.maxFileBytes || state.totalBytes + bytes.byteLength > state.maxTotalBytes) {
      throw new Error('Dictionary import exceeds its file-size budget');
    }
    state.totalBytes += bytes.byteLength;
    const source = bytes.toString('utf8').replace(/^\uFEFF/, '');
    let rows: JsonMap[];
    if (path.extname(realPath).toLowerCase() === '.csv') {
      const [headers = [], ...csvRows] = parseCsv(source);
      rows = csvRows.map((cells) =>
        normalizeTerm(Object.fromEntries(headers.map((header, index) => [header.trim(), cells[index] ?? '']))),
      );
    } else {
      const parsed = JSON.parse(source) as unknown;
      if (Array.isArray(parsed)) rows = parsed.map((row) => normalizeTerm(requiredMap(row, 'Dictionary term')));
      else if (parsed && typeof parsed === 'object' && Array.isArray(requiredMap(parsed, 'Dictionary source').terms)) {
        const dictionary = requiredMap(parsed, 'Dictionary source');
        if (text(dictionary.schemaVersion) !== '0.3.0') {
          throw new Error('Dictionary JSON must use schema v0.3.0');
        }
        rows = fromDictionaryCore(dictionary);
        const termFiles = dictionary.termFiles === undefined ? [] : dictionary.termFiles;
        if (
          !Array.isArray(termFiles) ||
          !termFiles.every((fileName): fileName is string => typeof fileName === 'string')
        ) {
          throw new Error('Dictionary JSON contains an invalid term file list');
        }
        for (const fileName of termFiles) {
          if (path.isAbsolute(fileName)) throw new Error('Dictionary term file paths must be relative');
          rows.push(...readDictionaryImportFile(path.resolve(path.dirname(realPath), fileName), state, depth + 1));
        }
      } else throw new Error('JSON must be a v0.3.0 term array or dictionary source');
    }
    state.cache.set(realPath, rows);
    return rows;
  } finally {
    state.active.delete(realPath);
  }
}

export function readDictionaryImports(
  filePaths: readonly string[],
  options: DictionaryImportReadOptions = {},
): JsonMap[] {
  if (!filePaths.length) return [];
  const resolvedPaths = filePaths.map((filePath) => path.resolve(filePath));
  const rootPath = realpathSync(options.rootPath ? path.resolve(options.rootPath) : path.dirname(resolvedPaths[0]));
  const state: DictionaryImportReadState = {
    rootPath,
    maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    maxTotalBytes: options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
    maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
    totalBytes: 0,
    cache: new Map(),
    active: new Set(),
  };
  return resolvedPaths.flatMap((filePath) => readDictionaryImportFile(filePath, state, 0));
}

export function readDictionaryImport(filePath: string, options: DictionaryImportReadOptions = {}): JsonMap[] {
  return readDictionaryImports([filePath], options);
}

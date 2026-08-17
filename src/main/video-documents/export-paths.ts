const MAX_FILE_COMPONENT_BYTES = 255;

export type VideoDocumentExportRole = 'CLEAN_TRANSCRIPT' | 'ARTICLE';

function utf8ByteLength(value: string) {
  return Buffer.byteLength(value, 'utf8');
}

export function truncateUtf8(value: string, maximumBytes: number) {
  if (maximumBytes <= 0) return '';
  let result = '';
  let bytes = 0;
  for (const character of value) {
    const characterBytes = utf8ByteLength(character);
    if (bytes + characterBytes > maximumBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function sanitizedTitle(value: string) {
  const clean = value
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  if (!clean) return 'video-document';
  return /^(con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(clean) ? `_${clean}` : clean;
}

function roleLabel(role: VideoDocumentExportRole) {
  return role === 'CLEAN_TRANSCRIPT' ? '逐字稿' : '图文稿';
}

function boundedExportBaseName(
  title: string,
  role: VideoDocumentExportRole,
  collisionIndex: number,
  extension: string,
) {
  const collisionSuffix = collisionIndex > 1 ? ` (${collisionIndex})` : '';
  const fixedSuffix = `-${roleLabel(role)}${collisionSuffix}`;
  const titleBudget = MAX_FILE_COMPONENT_BYTES - utf8ByteLength(fixedSuffix) - utf8ByteLength(extension);
  const boundedTitle = truncateUtf8(sanitizedTitle(title), titleBudget).replace(/[. ]+$/g, '') || 'video-document';
  return `${boundedTitle}${fixedSuffix}`;
}

export function videoDocumentMarkdownBundleName(title: string, role: VideoDocumentExportRole, collisionIndex = 1) {
  return boundedExportBaseName(title, role, collisionIndex, '.md');
}

export function videoDocumentExportFileName(title: string, role: VideoDocumentExportRole, format: 'MARKDOWN' | 'DOCX') {
  const extension = format === 'MARKDOWN' ? '.md' : '.docx';
  return `${boundedExportBaseName(title, role, 1, extension)}${extension}`;
}

export function safeVideoDocumentAssetStem(value: string) {
  return truncateUtf8(sanitizedTitle(value), 180).replace(/[. ]+$/g, '') || 'asset';
}

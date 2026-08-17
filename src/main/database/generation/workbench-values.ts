import type {
  AnnotationBrushGeometry,
  AssetDto,
  GenerationErrorDetailsDto,
  GenerationInput,
  Locale,
  PromptCommonInputDto,
} from '@/shared/contracts';
import { type JsonMap, mediaUrl, text } from '@/main/database/core/values';
import { canonicalSnapshotJson } from '@/main/database/generation/snapshot-content';

export function jsonStringRecord(value: unknown): Record<string, string> {
  try {
    const parsed = JSON.parse(text(value)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

export function sortedRecord(value: Record<string, string>) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

export function promptInputWithoutRedundantTextNode(input: PromptCommonInputDto): PromptCommonInputDto {
  const nodes = input.contentNodes;
  if (nodes?.length !== 1 || nodes[0].kind !== 'TEXT' || nodes[0].text.trim() !== input.userInstruction.trim())
    return input;
  const { contentNodes: _contentNodes, ...rest } = input;
  return rest;
}

export function samePromptInputAcrossTextComposerUpgrade(left: PromptCommonInputDto, right: PromptCommonInputDto) {
  return (
    canonicalSnapshotJson(promptInputWithoutRedundantTextNode(left)) ===
    canonicalSnapshotJson(promptInputWithoutRedundantTextNode(right))
  );
}

export function brushBounds(geometry: AnnotationBrushGeometry, imageWidth: number, imageHeight: number) {
  const shortEdge = Math.max(1, Math.min(imageWidth, imageHeight));
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  let hasEditablePoint = false;
  for (const stroke of geometry.strokes) {
    if (stroke.mode !== 'ADD') continue;
    const radiusX = (stroke.radius * shortEdge) / Math.max(1, imageWidth);
    const radiusY = (stroke.radius * shortEdge) / Math.max(1, imageHeight);
    for (const point of stroke.points) {
      hasEditablePoint = true;
      minX = Math.min(minX, point.x - radiusX);
      minY = Math.min(minY, point.y - radiusY);
      maxX = Math.max(maxX, point.x + radiusX);
      maxY = Math.max(maxY, point.y + radiusY);
    }
  }
  if (!hasEditablePoint) throw new Error('Brush annotations require at least one editable stroke');
  const x = Math.max(0, Math.min(1, minX));
  const y = Math.max(0, Math.min(1, minY));
  const right = Math.max(x, Math.min(1, maxX));
  const bottom = Math.max(y, Math.min(1, maxY));
  return { x, y, width: right - x, height: bottom - y };
}

export interface GenerationComposition {
  referenceAssetIds: string[];
  termPromptLocale: Locale;
  termIds: string[];
  wordPaletteReferences: Array<{
    paletteId: string;
    paletteRevisionId: string;
    promptLocale: Locale;
    parameterValues: Record<string, string>;
  }>;
}

export interface PreparedPaletteBinding {
  reference: GenerationComposition['wordPaletteReferences'][number];
  normalizedValues: Record<string, string>;
  mediaAssetIds: string[];
}

export function normalizedGenerationComposition(input: GenerationInput): GenerationComposition {
  return {
    referenceAssetIds: [...new Set(input.referenceAssetIds)],
    termPromptLocale: input.termPromptLocale === 'zh' ? 'zh' : 'en',
    termIds: [...new Set(input.termIds)],
    wordPaletteReferences: input.wordPaletteReferences.map((reference) => ({
      paletteId: reference.paletteId,
      paletteRevisionId: reference.paletteRevisionId,
      promptLocale: reference.promptLocale,
      parameterValues: sortedRecord(reference.parameterValues),
    })),
  };
}

export function nullableDimension(value: unknown): number | null {
  const dimension = Number(value);
  return Number.isFinite(dimension) && dimension > 0 ? dimension : null;
}

export function parsedObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text(value)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function generationErrorDetails(value: unknown): GenerationErrorDetailsDto | null {
  const payload = parsedObject(value);
  const candidate = payload.errorDetails;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const record = candidate as Record<string, unknown>;
  if (typeof record.retryable !== 'boolean') return null;
  const metadata = record.metadata;
  return {
    retryable: record.retryable,
    providerCode: typeof record.providerCode === 'string' ? record.providerCode : null,
    metadata:
      metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {},
  };
}

export function pushMapped<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const current = map.get(key);
  if (current) current.push(value);
  else map.set(key, [value]);
}

export function joinedAssetDto(row: JsonMap): AssetDto | null {
  if (!row.asset_id) return null;
  const id = text(row.asset_id);
  return {
    id,
    kind: text(row.asset_kind) as AssetDto['kind'],
    originType: text(row.asset_origin_type),
    width: Number(row.asset_width),
    height: Number(row.asset_height),
    mimeType: text(row.asset_mime_type),
    byteSize: Number(row.asset_byte_size),
    mediaUrl: mediaUrl(id),
    createdAt: text(row.asset_created_at),
  };
}

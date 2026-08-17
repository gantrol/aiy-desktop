import type { AnnotationBrushGeometry, AnnotationDto, Locale } from '@/shared/contracts';

export type JsonMap = Record<string, unknown>;

export const text = (value: unknown) => (typeof value === 'string' ? value : '');

export const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

export function localized(value: unknown, locale: Locale): string {
  const map = value && typeof value === 'object' ? (value as JsonMap) : {};
  return text(map[locale]) || text(map[locale === 'zh' ? 'en' : 'zh']);
}

export function now() {
  return new Date().toISOString();
}

export const mediaUrl = (id: string) => `aiy-media://asset/${encodeURIComponent(id)}`;

function annotationGeometry(value: unknown): AnnotationBrushGeometry | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<AnnotationBrushGeometry>;
    if (parsed.version !== 1 || !Array.isArray(parsed.strokes)) return null;
    return parsed as AnnotationBrushGeometry;
  } catch {
    return null;
  }
}

export function annotationDto(row: JsonMap): AnnotationDto {
  return {
    id: text(row.id),
    imageAssetId: text(row.image_asset_id),
    type: text(row.type) as AnnotationDto['type'],
    x: Number(row.x),
    y: Number(row.y),
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    geometry: annotationGeometry(row.geometry_json),
    comment: text(row.comment),
    status: text(row.status) as AnnotationDto['status'],
    createdAt: text(row.created_at),
  };
}

import { z } from 'zod';
import type { ImportedImageMetadataInput } from '@/shared/contracts/import-metadata';

export type CreatorImageImportSource = 'PASTE' | 'DROP' | 'UPLOAD';

export const creatorImageImportMimeTypeSchema = z.enum([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);
export type CreatorImageImportMimeType = z.infer<typeof creatorImageImportMimeTypeSchema>;
export type CreatorRasterImageMimeType = Exclude<CreatorImageImportMimeType, 'image/svg+xml'>;

export interface CreatorImageImportItemInput {
  id: string;
  name: string;
  mimeType: CreatorImageImportMimeType;
  bytes: Uint8Array;
  metadata?: ImportedImageMetadataInput;
}

export interface CreatorImageImportContext {
  seriesId: string | null;
  versionId: string | null;
  title: string;
  titleLocale?: 'zh' | 'en';
  source: CreatorImageImportSource;
  sourceUrl?: string;
}

export interface CreatorImageImportInput {
  context: CreatorImageImportContext;
  items: CreatorImageImportItemInput[];
}

export interface CreatorClipboardReferenceImportInput {
  context: CreatorImageImportContext;
}

export interface CreatorImageChooseInput {
  context: CreatorImageImportContext;
}

export type CreatorImageStageState = 'READY' | 'DUPLICATE' | 'INVALID';

export interface CreatorImageStagePreviewRow {
  item: {
    id: string;
    stageId: string | null;
    name: string;
    mimeType: CreatorImageImportItemInput['mimeType'];
    byteSize: number;
  };
  state: CreatorImageStageState;
  previewUrl?: string;
  expiresAt?: number;
}

export interface CreatorStagedOutputImportItemInput {
  stageId: string;
  promptVersionId: string | null;
  /** Resolved or created atomically at import, with unknown external prompt provenance. */
  newVersionNo?: number;
  displayName: string;
  source?: CreatorImageImportSource;
  sourceUrl?: string;
}

export interface CreatorStagedImageImportInput {
  context: CreatorImageImportContext;
  /** Array order is inserted at the front of the creation's durable output order. */
  items: CreatorStagedOutputImportItemInput[];
}

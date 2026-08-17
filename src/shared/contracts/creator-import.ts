import type { ImportedImageMetadataInput } from '@/shared/contracts/import-metadata';

export type CreatorImageImportSource = 'PASTE' | 'DROP' | 'UPLOAD';

export interface CreatorImageImportItemInput {
  id: string;
  name: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
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
}

export interface CreatorStagedImageImportInput {
  context: CreatorImageImportContext;
  stageIds: string[];
}

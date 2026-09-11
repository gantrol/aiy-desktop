import type { CreationItemDto, InspirationStashDto } from '@/shared/contracts';
import { blockDocumentSchema, type BlockDocument } from '@/shared/contracts/block-document';
import type { CodexContentApi } from '@/shared/contracts/codex-content';
import { contentApplicationSchema, type ContentApplicationsApi } from '@/shared/contracts/content-applications';
import type { ContentImageImportsApi } from '@/shared/contracts/content-image-import';
import type { ContentLibraryApi } from '@/shared/contracts/content-library';
import {
  petalColorSchema,
  petalIconSchema,
  type PetalColor,
  type PetalIcon,
} from '@/shared/contracts/petal-appearance';
import {
  petalBoardSchema,
  type PetalBoardCommand,
  type PinSearch,
  type PinSource,
  type PinSummary,
} from '@/shared/contracts/petal-board';
import {
  petalHubSettingsSchema,
  petalHubViewSchema,
  petalTimerSchema,
  type PetalHubSettings,
  type PetalHubView,
  type PetalQuota,
  type PetalTimerAction,
} from '@/shared/contracts/petal-hub';
import type { PetalLanguage } from '@/shared/contracts/petal-language';
import { z } from 'zod';
import { noteFileSchema, type NoteFile, type NoteFileCommand } from '@/shared/contracts/note-files';
import {
  contentCommentAnchorSchema,
  contentCommentAnchorUpdateSchema,
  contentCommentSchema,
  contentElementPlacementSchema,
} from '@/shared/contracts/content-comments';
import type { PetalPreviewContent, PetalPreviewRequest } from '@/shared/petal-preview';
import {
  petalDrawerStateSchema,
  type PetalDrawerCommand,
  type PetalDrawerFrame,
  type PetalDrawerPointer,
} from '@/shared/contracts/petal-drawer';
export {
  petalColorSchema,
  petalIconSchema,
  type PetalColor,
  type PetalIcon,
} from '@/shared/contracts/petal-appearance';

const id = z.string().min(1).max(200);
export const noteCommentSchema = contentCommentSchema.extend({ noteId: id }).strict();
export const noteCommentMutationInputSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('CREATE'),
      noteId: id,
      expectedRevisionId: id,
      elements: z.array(contentElementPlacementSchema).max(20_000),
      anchor: contentCommentAnchorSchema,
      preview: z.string().max(280),
      body: z.string().max(10_000),
    })
    .strict(),
  z.object({ operation: z.literal('UPDATE_BODY'), noteId: id, commentId: id, body: z.string().max(10_000) }).strict(),
  z
    .object({
      operation: z.literal('SET_STATUS'),
      noteId: id,
      commentId: id,
      status: z.enum(['OPEN', 'RESOLVED', 'REJECTED']),
    })
    .strict(),
  z
    .object({ operation: z.literal('ADD_REPLY'), noteId: id, commentId: id, body: z.string().min(1).max(10_000) })
    .strict(),
  z.object({ operation: z.literal('DELETE'), noteId: id, commentId: id }).strict(),
]);
export const noteCommentMutationResultSchema = z
  .object({ noteId: id, revisionId: id, comments: z.array(noteCommentSchema).max(20_000) })
  .strict();
export const petalNoteSizeSchema = z
  .object({
    width: z.number().int().min(280).max(640),
    height: z.number().int().min(300).max(800),
  })
  .strict();
export const petalPointSchema = z
  .object({ x: z.number().int().min(-100_000).max(100_000), y: z.number().int().min(-100_000).max(100_000) })
  .strict();
export const desktopNoteSchema = z
  .object({
    id,
    stashId: id,
    text: z.string().max(1_000_000),
    contentHash: z.string(),
    color: petalColorSchema,
    icon: petalIconSchema,
    editable: z.boolean(),
    title: z.string(),
    displayTitle: z.string().default(''),
    albumId: id.nullable().default(null),
    format: z.literal('markdown').optional(),
    document: blockDocumentSchema.optional(),
    importedImages: z
      .array(
        z.object({
          id,
          mediaUrl: z.string(),
          mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
          width: z.number(),
          height: z.number(),
          byteSize: z.number(),
        }),
      )
      .optional(),
    revisionId: id.nullable(),
    elements: z.array(contentElementPlacementSchema).max(20_000).default([]),
    comments: z.array(noteCommentSchema).max(20_000).default([]),
    persisted: z.boolean().default(true),
    files: z.array(noteFileSchema).max(100).optional(),
    references: z
      .array(z.object({ assetId: id, mediaUrl: z.string() }))
      .max(100)
      .default([]),
  })
  .strict();
export const desktopNoteCreateSchema = z
  .object({
    requestId: id,
    stashId: id.optional(),
    duplicate: z.boolean().optional(),
    point: petalPointSchema.optional(),
    expanded: z.boolean().optional(),
    home: z.enum(['desktop', 'drawer']).optional(),
  })
  .strict();
export const desktopNoteSaveSchema = z
  .object({
    id,
    text: z.string().max(1_000_000),
    title: z.string().max(200).optional(),
    format: z.literal('markdown').optional(),
    document: blockDocumentSchema.optional(),
    referenceAssetIds: z.array(id).max(100).optional(),
    elements: z.array(contentElementPlacementSchema).max(20_000).optional(),
    commentAnchors: z.array(contentCommentAnchorUpdateSchema).max(20_000).optional(),
    expectedContentHash: z.string().min(1),
    expectedRevisionId: id.nullable().optional(),
    editorId: id,
  })
  .strict();
export const desktopNoteAppearanceSchema = z
  .object({ id, color: petalColorSchema.optional(), icon: petalIconSchema.optional() })
  .strict();
export const desktopNoteDraftSchema = desktopNoteSaveSchema.extend({ sequence: z.number().int().nonnegative() });
export const desktopNoteDraftDtoSchema = z
  .object({
    text: z.string(),
    title: z.string().max(200).optional(),
    format: z.literal('markdown').optional(),
    document: blockDocumentSchema.optional(),
    referenceAssetIds: z.array(id).max(100).optional(),
    elements: z.array(contentElementPlacementSchema).max(20_000).optional(),
    commentAnchors: z.array(contentCommentAnchorUpdateSchema).max(20_000).optional(),
    expectedContentHash: z.string(),
    expectedRevisionId: id.nullable().optional(),
    editorId: id,
    sequence: z.number().int(),
  })
  .strict();
export const desktopPetalSnapshotSchema = z
  .object({
    titlesVisible: z.boolean().default(true),
    libraryId: id,
    libraryName: z.string(),
    instanceId: id.nullable(),
    drawerWindow: z.boolean().default(false),
    home: z.enum(['desktop', 'drawer']).default('desktop'),
    drawer: petalDrawerStateSchema.nullable().default(null),
    placements: z
      .record(z.string(), z.object({ visible: z.boolean(), home: z.enum(['desktop', 'drawer']) }))
      .default({}),
    expanded: z.boolean(),
    alwaysOnTop: z.boolean().default(true),
    collectionUndo: z.object({ token: z.string().uuid(), expiresAt: z.number() }).nullable().default(null),
    editEpoch: z.number().int().nonnegative().default(0),
    point: petalPointSchema,
    notes: z.array(desktopNoteSchema),
    draft: desktopNoteDraftDtoSchema.nullable(),
    suspended: z.boolean(),
    contentActions: z.array(z.string()).default([]),
    contentApplications: z.array(contentApplicationSchema).default([]),
    hubView: petalHubViewSchema.default('flower'),
    hubSettings: petalHubSettingsSchema.default(() => petalHubSettingsSchema.parse({})),
    timer: petalTimerSchema.default(() => petalTimerSchema.parse({})),
    board: petalBoardSchema,
    flowerAnchor: petalPointSchema.default({ x: 112, y: 112 }),
    flowerPreview: z.boolean().default(false),
    dock: z
      .object({
        edge: z.enum(['left', 'right', 'top', 'bottom']),
        collapsed: z.boolean(),
        petalBounds: petalPointSchema
          .extend({ width: z.number().positive(), height: z.number().positive() })
          .optional(),
      })
      .nullable()
      .default(null),
  })
  .strict();
export type DesktopNote = z.infer<typeof desktopNoteSchema>;
export interface DesktopNoteInitial {
  files?: NoteFile[];
  document?: BlockDocument;
  text: string;
  title?: string;
  format?: 'markdown';
  albumId?: string | null;
  referenceAssetIds?: string[];
  color?: PetalColor;
  icon?: PetalIcon;
}
export type DesktopPetalSnapshot = z.infer<typeof desktopPetalSnapshotSchema>;
export type DesktopNoteSave = z.infer<typeof desktopNoteSaveSchema>;
export type DesktopNoteDraft = z.infer<typeof desktopNoteDraftSchema>;
export type NoteCommentDto = z.infer<typeof noteCommentSchema>;
export type NoteCommentMutationInput = z.infer<typeof noteCommentMutationInputSchema>;
export type NoteCommentMutationResult = z.infer<typeof noteCommentMutationResultSchema>;
export interface DesktopPetalSourceEvent {
  article: import('@/shared/contracts').ArticleDto;
  libraryId: string;
  stash: InspirationStashDto;
  item: CreationItemDto | null;
  open: boolean;
}
export interface DesktopPetalsApi extends ContentImageImportsApi {
  files(command: NoteFileCommand): Promise<DesktopNote>;
  preview(input: PetalPreviewRequest): Promise<PetalPreviewContent | null>;
  drawer(command: PetalDrawerCommand): Promise<void>;
  onDrawerFrame(callback: (frame: PetalDrawerFrame) => void): () => void;
  onDrawerPointer(callback: (event: PetalDrawerPointer) => void): () => void;
  onTitlesChanged(callback: (visible: boolean) => void): () => void;
  externalApplications: ContentApplicationsApi;
  contentLibrary: ContentLibraryApi;
  albums(): Promise<{ id: string; title: string }[]>;
  setAlbum(input: { id: string; albumId: string | null }): Promise<DesktopNote>;
  references(input: PetalReferenceCommand): Promise<DesktopNote | PinSummary[]>;
  codex: CodexContentApi;
  onNavigate(
    callback: (event: {
      libraryId: string;
      kind: 'CODEX' | 'CODEX_SETTINGS' | 'ALBUM' | 'MATERIAL' | 'SOURCE';
      id: string | null;
    }) => void,
  ): () => void;
  boardCommand(command: PetalBoardCommand): Promise<void>;
  searchPinSources(input: PinSearch): Promise<PinSummary[]>;
  onOpenPin(callback: (event: { libraryId: string; source: PinSource }) => void): () => void;
  pluckPreview(active: boolean): Promise<void>;
  pluckWatch(token: string, active: boolean): Promise<boolean>;
  onPluckPointer(callback: (event: import('./petal-pluck').PetalPluckPointer) => void): () => void;
  pluckPosition(
    point: z.infer<typeof petalPointSchema>,
    pointer?: z.infer<typeof petalPointSchema>,
  ): Promise<z.infer<typeof petalPointSchema>>;
  revealDock(expanded: boolean): Promise<void>;
  setMenuOpen(open: boolean, point?: z.infer<typeof petalPointSchema>): Promise<z.infer<typeof petalPointSchema>>;
  onMenuRequested(callback: () => void): () => void;
  language(): Promise<PetalLanguage>;
  setLanguage(language: PetalLanguage): Promise<void>;
  onLanguageChanged(callback: (language: PetalLanguage) => void): () => void;
  show(): Promise<void>;
  showAll(): Promise<void>;
  hideAll(): Promise<void>;
  hidePetals(): Promise<void>;
  cleanup(color?: PetalColor): Promise<void>;
  reload(): Promise<void>;
  hubView(view: PetalHubView): Promise<void>;
  configureHub(settings: PetalHubSettings): Promise<void>;
  timerAction(action: PetalTimerAction): Promise<void>;
  hubQuota(): Promise<PetalQuota>;
  snapshot(): Promise<DesktopPetalSnapshot>;
  rendered(): Promise<void>;
  create(input: z.infer<typeof desktopNoteCreateSchema>): Promise<DesktopNote>;
  open(id: string): Promise<void>;
  save(input: DesktopNoteSave): Promise<DesktopNote>;
  checkpoint(input: DesktopNoteDraft): Promise<void>;
  appearance(input: z.infer<typeof desktopNoteAppearanceSchema>): Promise<DesktopNote>;
  expand(expanded: boolean): Promise<void>;
  setAlwaysOnTop(alwaysOnTop: boolean): Promise<void>;
  undoCollection(token: string): Promise<void>;
  resize(size: z.infer<typeof petalNoteSizeSchema>): Promise<void>;
  hide(): Promise<void>;
  remove(): Promise<void>;
  move(point: z.infer<typeof petalPointSchema>): Promise<void>;
  beginDrag(point: z.infer<typeof petalPointSchema>): Promise<void>;
  endDrag(cancel: boolean, released?: boolean, point?: z.infer<typeof petalPointSchema>): Promise<void>;
  openMain(): Promise<void>;
  onChanged(callback: () => void): () => void;
  onSourceChanged(callback: (event: DesktopPetalSourceEvent) => void): () => void;
  onFlush(callback: (save?: boolean) => Promise<boolean>): () => void;
}

export const petalReferenceFileSchema = z
  .object({
    name: z.string().min(1).max(500),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
    bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= 25 * 1024 * 1024),
  })
  .strict();
export const petalReferenceCommandSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('import'),
      id,
      expectedHash: z.string(),
      source: z.enum(['UPLOAD', 'PASTE', 'DROP']),
      items: z
        .array(petalReferenceFileSchema)
        .min(1)
        .max(8)
        .refine((items) => items.reduce((size, item) => size + item.bytes.byteLength, 0) <= 100 * 1024 * 1024),
    })
    .strict(),
  z
    .object({ kind: z.literal('search'), id, query: z.string().max(100), offset: z.number().int().min(0).max(10000) })
    .strict(),
  z.object({ kind: z.literal('upload'), id, expectedHash: z.string() }).strict(),
  z.object({ kind: z.literal('add'), id, expectedHash: z.string(), assetId: id }).strict(),
  z.object({ kind: z.literal('remove'), id, expectedHash: z.string(), assetId: id }).strict(),
]);
export type PetalReferenceCommand = z.infer<typeof petalReferenceCommandSchema>;
declare global {
  interface Window {
    desktopPetals: DesktopPetalsApi;
  }
}

import type { FillDraftErrorCode } from '@/lib/protocol';

export type ComposerElement = HTMLTextAreaElement | HTMLElement;
export type TextControl = HTMLInputElement | ComposerElement;

export interface ComposerMediaSnapshot {
  elements: ReadonlySet<Element>;
}

export interface ComposerAdapter {
  validateDraft?(draft: string, title?: string): FillDraftErrorCode | null;
  prepareMedia?(
    files: readonly File[],
    options: { replaceExisting?: boolean; title?: string },
  ): Promise<{ ok: true; editor: ComposerElement } | { ok: false; code: FillDraftErrorCode }>;
  writeTitle?(editor: TextControl, title: string, replaceExisting: boolean): Promise<boolean>;
  fillArticle?(
    editor: ComposerElement,
    html: string,
    files: readonly File[],
    coverMediaIndex?: number,
  ): Promise<FillDraftErrorCode | null>;
  acceptsMedia?(files: readonly File[]): boolean;
  hasExistingMedia?(editor: ComposerElement): boolean;
  findEditors(): ComposerElement[];
  findTitle?(editor: ComposerElement): TextControl | null;
  readText?(editor: TextControl): string;
  splitDraft?(draft: string): string[] | null;
  appendDraft?(editor: ComposerElement, drafts: readonly string[]): Promise<boolean>;
  writeText?(editor: ComposerElement, draft: string, replaceExisting: boolean): Promise<boolean>;
  findMediaInput(editor: ComposerElement): HTMLInputElement | null;
  requestMediaInput(editor: ComposerElement): void;
  openComposer?(handoffId: string): Promise<boolean>;
  captureMedia?(): ComposerMediaSnapshot | null;
  confirmMedia?(files: readonly File[], snapshot: ComposerMediaSnapshot | null, timeoutMs: number): Promise<boolean>;
}

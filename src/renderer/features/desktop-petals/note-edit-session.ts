import { canLeavePetal, type PetalFlushReport } from '@/shared/petal-flush';
import { isBlankPetalInput } from '@/shared/petal-input-preservation';
import type { BlockDocument } from '@/shared/contracts/block-document';
import { ContentCheckpointTimer } from '@/renderer/features/content-editor/ContentCheckpointTimer';
import { blockDocumentImportIds } from '@/shared/contracts/block-document';
import type { DesktopNote, DesktopPetalSnapshot, DesktopPetalsApi } from '@/shared/contracts/desktop-petals';
import type {
  ContentCommentAnchorUpdateInput,
  ContentElementPlacementInput,
} from '@/shared/contracts/content-comments';
import type { NoteCommentDto } from '@/shared/contracts/desktop-petals';

interface State {
  note: DesktopNote;
  text: string;
  title: string;
  format?: 'markdown';
  document?: BlockDocument;
  editorEpoch: number;
  referenceAssetIds: string[];
  elements: ContentElementPlacementInput[];
  commentAnchors: ContentCommentAnchorUpdateInput[];
  status: 'saved' | 'dirty' | 'saving' | 'error';
  error: string;
  frozen: boolean;
}
/** Serializes checkpoints and saves without letting acknowledgements replace newer typing. */
export class NoteEditSession {
  private state: State;
  private listeners = new Set<() => void>();
  private baseHash: string;
  private baseRevisionId: string | null | undefined;
  private readonly editorId: string;
  private sequence: number;
  private generation = 0;
  private savedGeneration = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly checkpointTimer = new ContentCheckpointTimer();
  private saving: Promise<boolean> | null = null;
  private composing = false;
  constructor(
    note: DesktopNote,
    draft: DesktopPetalSnapshot['draft'],
    private readonly api: Pick<DesktopPetalsApi, 'checkpoint' | 'save'>,
  ) {
    this.baseHash = draft?.expectedContentHash ?? note.contentHash;
    this.baseRevisionId = draft ? draft.expectedRevisionId : note.revisionId;
    this.editorId = draft?.editorId ?? crypto.randomUUID();
    this.sequence = draft?.sequence ?? 0;
    this.generation = draft ? 1 : 0;
    this.state = {
      note,
      text: draft?.text ?? note.text,
      title: draft?.title ?? note.title,
      format: draft?.format ?? note.format,
      document: draft?.document ?? note.document,
      editorEpoch: 0,
      referenceAssetIds: draft?.referenceAssetIds ?? note.references.map((reference) => reference.assetId),
      elements: draft?.elements ?? note.elements,
      commentAnchors: draft?.commentAnchors ?? [],
      status: draft ? 'dirty' : 'saved',
      error: '',
      frozen: false,
    };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  edit(
    text: string,
    metadata: {
      title?: string;
      format?: 'markdown';
      document?: BlockDocument;
      referenceAssetIds?: string[];
      elements?: ContentElementPlacementInput[];
      commentAnchors?: ContentCommentAnchorUpdateInput[];
    } = {},
  ) {
    if (this.state.frozen) return;
    this.generation++;
    this.publish({ text, ...metadata, status: 'dirty', error: '' });
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.composing) return;
    this.checkpointTimer.schedule(() => {
      const generation = this.generation;
      void this.checkpoint().catch((error) => {
        if (generation === this.generation && generation !== this.savedGeneration)
          this.publish({ status: 'error', error: String(error) });
      });
    }, 180);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 750);
  }
  receive(note: DesktopNote) {
    if (this.generation === this.savedGeneration && !this.saving) {
      const documentChanged = note.document !== undefined && note.contentHash !== this.baseHash;
      this.baseHash = note.contentHash;
      this.baseRevisionId = note.revisionId;
      this.publish({
        note,
        referenceAssetIds: note.references.map((reference) => reference.assetId),
        elements: note.elements,
        commentAnchors: [],
        text: note.text,
        title: note.title,
        format: note.format,
        document: note.document,
        editorEpoch:
          this.state.editorEpoch +
          Number(documentChanged || note.text !== this.state.text || note.format !== this.state.format),
      });
    } else this.publish({ note });
  }
  private input() {
    return {
      id: this.state.note.id,
      text: this.state.text,
      title: this.state.title,
      referenceAssetIds: this.state.referenceAssetIds,
      format: this.state.format,
      document: this.state.document,
      elements: this.state.elements,
      commentAnchors: this.state.commentAnchors,
      expectedContentHash: this.baseHash,
      expectedRevisionId: this.baseRevisionId,
      editorId: this.editorId,
    };
  }
  private checkpoint() {
    return this.api.checkpoint({ ...this.input(), sequence: ++this.sequence });
  }
  flush = (): Promise<boolean> => {
    this.clearTimers();
    if (this.composing) return Promise.resolve(false);
    if (this.saving) return this.saving;
    if (this.generation === this.savedGeneration) return Promise.resolve(true);
    this.saving = this.save().finally(() => {
      this.saving = null;
    });
    return this.saving;
  };
  private async save() {
    try {
      while (this.generation !== this.savedGeneration) {
        if (this.composing) return false;
        const generation = this.generation;
        const input = this.input();
        this.publish({ status: 'saving', error: '' });
        await this.api.checkpoint({ ...input, sequence: ++this.sequence });
        const note = await this.api.save(input);
        this.baseHash = note.contentHash;
        this.baseRevisionId = note.revisionId;
        this.savedGeneration = generation;
        this.publish({ note, status: this.generation === generation ? 'saved' : 'dirty' });
      }
      return true;
    } catch (error) {
      this.publish({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }
  keepMine = () => {
    this.baseHash = this.state.note.contentHash;
    this.baseRevisionId = this.state.note.revisionId;
    return this.flush();
  };
  useSaved = () => {
    this.baseHash = this.state.note.contentHash;
    this.baseRevisionId = this.state.note.revisionId;
    this.publish({ editorEpoch: this.state.editorEpoch + 1 });
    this.edit(this.state.note.text, {
      title: this.state.note.title,
      format: this.state.note.format,
      document: this.state.note.document,
      referenceAssetIds: this.state.note.references.map((reference) => reference.assetId),
      elements: this.state.note.elements,
      commentAnchors: [],
    });
    return this.flush();
  };
  /** Callers that only need leave-safety keep the Boolean facade. */
  checkpointForExit = async () => canLeavePetal(await this.prepareToLeave());

  prepareToLeave = async (requireRevision = false): Promise<PetalFlushReport> => {
    this.clearTimers();
    if (this.composing) return { status: 'blocked', reason: 'composing' };
    const hadChanges = this.generation !== this.savedGeneration;
    const hasImports = Boolean(this.state.document && blockDocumentImportIds(this.state.document).length);
    if (hasImports && (requireRevision || !this.state.note.persisted))
      return { status: 'blocked', reason: 'pendingWork' };
    try {
      const saved = !hasImports && (await this.flush());
      if (this.composing) return { status: 'blocked', reason: 'composing' };
      if (!this.state.note.persisted) {
        // Provisional checkpoints live in memory, not in the library. They cannot authorize disposal.
        return isBlankPetalInput(this.state) && !this.state.note.files?.length
          ? { status: 'unchanged' }
          : { status: 'blocked', reason: 'persistence' };
      }
      if (saved && this.generation === this.savedGeneration) return { status: hadChanges ? 'saved' : 'unchanged' };
      if (requireRevision) return { status: 'blocked', reason: 'unconfirmed' };
      const generation = this.generation;
      await this.checkpoint();
      if (generation !== this.generation || this.composing) return { status: 'blocked', reason: 'pendingWork' };
      // A failed commit can still leave a durable recovery draft. Do not relabel it as saved.
      return { status: 'recoverable', reason: hasImports ? 'pendingWork' : 'unconfirmed' };
    } catch (error) {
      this.publish({ status: 'error', error: String(error), frozen: false });
      return { status: 'blocked', reason: 'persistence' };
    }
  };
  private clearTimers() {
    if (this.timer) clearTimeout(this.timer);
    this.checkpointTimer.cancel();
    this.timer = null;
  }
  dispose() {
    this.clearTimers();
  }
  setFrozen(frozen: boolean) {
    if (frozen && this.composing) return false;
    this.publish({ frozen });
    return true;
  }
  replaceComments(comments: readonly NoteCommentDto[]) {
    this.publish({ note: { ...this.state.note, comments: [...comments] } });
  }
  updateProjection(
    elements: readonly ContentElementPlacementInput[],
    commentAnchors: readonly ContentCommentAnchorUpdateInput[],
    dirty = false,
  ) {
    const metadata = { elements: [...elements], commentAnchors: [...commentAnchors] };
    if (dirty) this.edit(this.state.text, metadata);
    else this.publish(metadata);
  }
  setComposing(composing: boolean) {
    this.composing = composing;
    if (composing) this.clearTimers();
    else void this.flush();
  }
}

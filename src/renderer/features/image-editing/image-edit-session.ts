import {
  imageEditDocumentSchema,
  type ImageEditDocument,
  type ImageEditSnapshot,
  type ImageEditCommand,
} from '@/shared/contracts/image-edit';
import { petalErrorCode } from '@/shared/petal-errors';

/** Serial receipts keep autosave, explicit completion and retry on the same revision. */
export class ImageEditSession {
  private remote: ImageEditSnapshot;
  private value: ImageEditDocument;
  private adopted: ImageEditDocument;
  private previous: ImageEditDocument[] = [];
  private next: ImageEditDocument[] = [];
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private pending?: ImageEditCommand;
  private timer?: ReturnType<typeof setTimeout>;
  private locks = 0;
  private state: {
    document: ImageEditDocument;
    canUndo: boolean;
    canRedo: boolean;
    error: boolean;
    saving: boolean;
    dirty: boolean;
    locked: boolean;
  };
  constructor(
    snapshot: ImageEditSnapshot,
    private readonly invoke: (input: ImageEditCommand) => Promise<ImageEditSnapshot>,
  ) {
    this.remote = snapshot;
    this.value = this.adopted = snapshot.draft ?? snapshot.document;
    this.state = {
      document: this.value,
      canUndo: false,
      canRedo: false,
      error: false,
      saving: false,
      dirty: false,
      locked: false,
    };
  }
  get sourceUrl() {
    return this.remote.sourceUrl;
  }
  get resultAssetId() {
    return this.remote.resultAssetId;
  }
  isAdopted(document: ImageEditDocument) {
    return !this.pending && JSON.stringify(document) === JSON.stringify(this.remote.document);
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit(patch: Partial<typeof this.state> = {}) {
    this.state = {
      ...this.state,
      document: this.value,
      canUndo: this.previous.length > 0,
      canRedo: this.next.length > 0,
      ...patch,
    };
    this.listeners.forEach((listener) => listener());
  }
  change = (document: ImageEditDocument, commit = true) => {
    if (this.locks) return;
    if (commit) {
      const result = imageEditDocumentSchema.safeParse(document);
      if (!result.success) {
        this.value = this.adopted;
        this.emit({ error: true });
        return;
      }
      if (JSON.stringify(document) !== JSON.stringify(this.adopted)) {
        this.previous = [...this.previous.slice(-19), this.adopted];
        this.next = [];
        this.adopted = document;
      }
    }
    this.value = document;
    this.emit({ dirty: true });
    clearTimeout(this.timer);
    if (commit)
      this.timer = setTimeout(() => {
        void this.checkpoint().catch(() => undefined);
      }, 700);
  };
  undo = () => {
    if (this.locks) return;
    const value = this.previous.pop();
    if (!value) return;
    this.next.push(this.adopted);
    this.value = this.adopted = value;
    this.emit({ dirty: true });
    this.schedule();
  };
  redo = () => {
    if (this.locks) return;
    const value = this.next.pop();
    if (!value) return;
    this.previous.push(this.adopted);
    this.value = this.adopted = value;
    this.emit({ dirty: true });
    this.schedule();
  };
  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.checkpoint().catch(() => undefined);
    }, 700);
  }
  private run<T>(operation: () => Promise<T>) {
    const task = this.queue.catch(() => undefined).then(operation);
    this.queue = task;
    return task;
  }
  private async send(build: () => ImageEditCommand) {
    // A lost reply must retry the exact operation before sending a newer draft.
    if (this.pending) {
      await this.deliverPending();
    }
    const command = build();
    const same = (value: ImageEditDocument) =>
      'document' in command && JSON.stringify(value) === JSON.stringify(command.document);
    if (command.kind === 'checkpoint' && same(this.remote.draft ?? this.remote.document)) return this.remote;
    if (command.kind === 'commit' && !this.remote.draft && same(this.remote.document)) return this.remote;
    if (command.kind === 'cancel' && !this.remote.draft) return this.remote;
    this.pending = command;
    await this.deliverPending();
    return this.remote;
  }
  private async deliverPending() {
    if (!this.pending) return;
    try {
      this.remote = await this.invoke(this.pending);
      this.pending = undefined;
    } catch (error) {
      // These rejections precede adoption. They must not prevent cancelling an over-budget edit.
      if (['temporaryCapacity', 'fileLimit', 'invalidSettings'].includes(petalErrorCode(error) ?? ''))
        this.pending = undefined;
      throw error;
    }
  }
  checkpoint = () => {
    clearTimeout(this.timer);
    return this.run(async () => {
      const document = this.value;
      if (!this.state.dirty && !this.pending) return;
      this.emit({ saving: true });
      try {
        await this.send(() => ({
          kind: 'checkpoint',
          document,
          expectedRevision: this.remote.revision,
          requestId: crypto.randomUUID(),
        }));
        this.emit({ error: false, dirty: document !== this.value });
      } catch (error) {
        this.emit({ error: true });
        throw error;
      } finally {
        this.emit({ saving: false });
      }
    });
  };
  commit(bytes: Uint8Array, document: ImageEditDocument) {
    clearTimeout(this.timer);
    return this.run(async () => {
      const result = await this.send(() => ({
        kind: 'commit',
        bytes,
        document,
        expectedRevision: this.remote.revision,
        requestId: crypto.randomUUID(),
      }));
      this.emit({ dirty: document !== this.value, error: false });
      return result;
    });
  }
  cancel() {
    clearTimeout(this.timer);
    return this.run(() =>
      this.send(() => ({ kind: 'cancel', expectedRevision: this.remote.revision, requestId: crypto.randomUUID() })),
    );
  }
  dispose() {
    clearTimeout(this.timer);
  }
  lock() {
    this.locks++;
    this.emit({ locked: true });
    return () => {
      this.locks--;
      this.emit({ locked: this.locks > 0 });
    };
  }
}

import {
  COMPOSER_WAIT_MS,
  currentHandoffSnapshotSchema,
  type CurrentHandoffSnapshot,
  type HandoffFillStage,
} from '@/lib/current-handoff-protocol';
import { downloadCompanionMedia, sendCompanionRequest } from '@/lib/loopback-client';
import {
  BROWSER_COMPANION_PROTOCOL_VERSION,
  browserCompanionInspectionSchema,
  type BrowserCompanionHandoff,
  type BrowserCompanionInspection,
  type CompanionSite,
  type ConsumeHandoffErrorCode,
  type ConsumeHandoffRequest,
  type ConsumeHandoffResponse,
  type FillDraftResponse,
} from '@/lib/protocol';

interface HandoffPage {
  ready(site: CompanionSite, contentKind?: string): boolean;
  waitReady?(site: CompanionSite, contentKind?: string): Promise<boolean>;
  fill(
    site: CompanionSite,
    requestId: string,
    handoff: BrowserCompanionHandoff,
    files: File[],
    beforeMutation: () => Promise<void>,
    onStage: (stage: HandoffFillStage) => void,
  ): Promise<FillDraftResponse>;
  delivered(handoff: BrowserCompanionHandoff): void;
}

/** Owns the current document's handoff, not the user's history or the latest task. */
export class CurrentHandoffSession {
  private value: CurrentHandoffSnapshot = {
    kind: 'current-handoff',
    site: null,
    state: 'empty',
    connection: 'unknown',
    stage: 'idle',
    code: null,
    task: null,
    canRetryReceipt: false,
    thumbnails: [],
  };
  private handoffId: string | undefined;
  private revision = 0;
  private busy = false;
  private pendingReceipt: BrowserCompanionHandoff | null = null;
  private editorWaitStartedAt: number | null = null;

  constructor(private readonly page: HandoffPage) {}

  snapshot(): CurrentHandoffSnapshot {
    // Schema validation also prevents authority tokens or raw file objects escaping to the popup.
    return currentHandoffSnapshotSchema.parse(this.value);
  }

  private change(patch: Partial<CurrentHandoffSnapshot>): void {
    this.revision += 1;
    this.value = { ...this.value, ...patch };
  }

  async inspect(site: CompanionSite | null, requestedId?: string): Promise<CurrentHandoffSnapshot> {
    if (!site) {
      return {
        ...this.snapshot(),
        site: null,
        state: 'unsupported',
        stage: 'idle',
        code: null,
        task: null,
        thumbnails: [],
        canRetryReceipt: false,
      };
    }
    const id = requestedId ?? this.handoffId;
    if (this.busy) {
      if (id !== this.handoffId) return { ...this.snapshot(), task: null, thumbnails: [], canRetryReceipt: false };
      return this.snapshot();
    }
    if (id !== this.handoffId || this.value.site !== site) {
      this.handoffId = id;
      this.pendingReceipt = null;
      this.editorWaitStartedAt = null;
      this.change({
        site,
        task: null,
        thumbnails: [],
        state: 'empty',
        code: null,
        canRetryReceipt: false,
        connection: 'unknown',
      });
    }
    const revision = this.revision;
    try {
      const response = await sendCompanionRequest(site, {
        protocolVersion: BROWSER_COMPANION_PROTOCOL_VERSION,
        kind: 'inspect-handoff',
        target: site,
        ...(id ? { handoffId: id } : {}),
      });
      if (revision !== this.revision) return this.snapshot();
      if (response.kind !== 'inspection') {
        this.change({
          connection: 'connected',
          state: response.kind === 'error' && response.code === 'HANDOFF_NOT_FOUND' ? 'empty' : 'failed',
          code: response.kind === 'error' ? response.code : 'INVALID_REQUEST',
          task: null,
          thumbnails: [],
          canRetryReceipt: false,
        });
        return this.snapshot();
      }
      const task = response.handoff;
      if ((task && (task.handoffId !== id || task.target !== site)) || (id && !task)) {
        this.change({
          connection: 'connected',
          state: 'failed',
          code: 'TARGET_MISMATCH',
          task: null,
          thumbnails: [],
          canRetryReceipt: false,
        });
        return this.snapshot();
      }
      this.change({ connection: 'connected', task, stage: 'idle' });
      if (!task) this.change({ state: 'empty', code: null });
      else if (task.state === 'delivered') {
        this.pendingReceipt = null;
        this.change({ state: 'delivered', code: null, canRetryReceipt: false });
      } else if (this.pendingReceipt?.handoffId === task.handoffId) {
        this.change({ state: 'receipt', code: 'RECEIPT_PENDING', canRetryReceipt: true });
      } else if (task.state === 'claimed') {
        this.change({
          state: this.value.state === 'media' ? 'media' : 'unknown',
          code: this.value.state === 'media' ? this.value.code : 'FILL_RESULT_UNKNOWN',
          canRetryReceipt: false,
        });
      } else {
        try {
          const ready = this.page.ready(site, task.contentKind);
          if (ready) this.editorWaitStartedAt = null;
          else this.editorWaitStartedAt ??= Date.now();
          const waiting = !ready && Date.now() - this.editorWaitStartedAt! < COMPOSER_WAIT_MS;
          // Inspection must not erase a failed attempt just because its lease was released.
          // A newly mounted editor can resolve COMPOSER_NOT_FOUND; other failures need an explicit retry.
          const keepFailure =
            ready &&
            this.value.state === 'failed' &&
            this.value.code !== null &&
            this.value.code !== 'COMPOSER_NOT_FOUND';
          this.change({
            state: keepFailure ? 'failed' : ready ? 'ready' : waiting ? 'waiting' : 'failed',
            stage: waiting ? 'waiting-editor' : 'idle',
            code: keepFailure ? this.value.code : ready || waiting ? null : 'COMPOSER_NOT_FOUND',
            canRetryReceipt: false,
          });
        } catch {
          this.change({ state: 'failed', code: 'FILL_FAILED', canRetryReceipt: false });
        }
      }
    } catch {
      if (revision !== this.revision) return this.snapshot();
      this.change({ connection: 'offline' });
      if (!this.pendingReceipt && !['media', 'unknown', 'delivered'].includes(this.value.state)) {
        this.change({ state: 'offline', code: 'DESKTOP_CONNECTION_FAILED' });
      }
    }
    return this.snapshot();
  }

  private async preview(files: File[], task: BrowserCompanionInspection): Promise<void> {
    const thumbnails: CurrentHandoffSnapshot['thumbnails'] = [];
    for (const [index, file] of files.slice(0, 3).entries()) {
      let bitmap: ImageBitmap | undefined;
      try {
        bitmap = await createImageBitmap(file);
        const scale = Math.min(1, 144 / bitmap.width, 128 / bitmap.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        if (!context) continue;
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png');
        if (dataUrl.length <= 40_000) thumbnails.push({ mediaId: task.media[index]!.mediaId, dataUrl });
      } catch {
        // A preview is optional. Keep the actual attachment and expose its name instead.
      } finally {
        bitmap?.close();
      }
    }
    if (task.handoffId === this.handoffId) this.change({ thumbnails });
  }

  async retryReceipt(site: CompanionSite, handoffId?: string): Promise<CurrentHandoffSnapshot> {
    const pending = this.pendingReceipt;
    if (!pending || pending.target !== site || pending.handoffId !== handoffId || this.busy)
      return this.inspect(site, handoffId);
    let notified = false;
    this.busy = true;
    this.change({ stage: 'receipt', canRetryReceipt: false });
    try {
      const response = await sendCompanionRequest(site, {
        protocolVersion: BROWSER_COMPANION_PROTOCOL_VERSION,
        kind: 'complete-handoff',
        handoffId: pending.handoffId,
        completionToken: pending.completionToken,
      });
      if (response.kind === 'completed' && response.handoffId === pending.handoffId) {
        this.pendingReceipt = null;
        this.change({
          state: 'delivered',
          connection: 'connected',
          code: null,
          task: this.value.task ? { ...this.value.task, state: 'delivered' } : null,
        });
        this.notifyDelivered(pending);
        notified = true;
      }
    } catch {
      this.change({ connection: 'offline' });
    } finally {
      this.busy = false;
      this.change({ stage: 'idle', canRetryReceipt: Boolean(this.pendingReceipt) });
    }
    if (notified) return this.snapshot();
    // A lost acknowledgement may follow a successful commit. Inspect, never claim/refill.
    const result = await this.inspect(site, handoffId);
    if (!notified && result.state === 'delivered' && this.pendingReceipt === null) this.notifyDelivered(pending);
    return result;
  }

  async consume(request: ConsumeHandoffRequest, site: CompanionSite): Promise<ConsumeHandoffResponse> {
    const fail = (code: ConsumeHandoffErrorCode): ConsumeHandoffResponse => ({
      ok: false,
      requestId: request.requestId,
      site,
      code,
    });
    if (this.busy) return fail('BUSY');
    if (!request.handoffId) return fail('HANDOFF_NOT_FOUND');
    const inspection = await this.inspect(site, request.handoffId);
    if (this.busy) return fail('BUSY');
    if (this.handoffId !== request.handoffId || (inspection.task && inspection.task.handoffId !== request.handoffId))
      return fail('TARGET_MISMATCH');
    if (inspection.state === 'receipt') await this.retryReceipt(site, request.handoffId);
    if (this.value.state === 'delivered' || this.value.state === 'receipt')
      return this.consumeResult(request.requestId, site);
    if (inspection.connection !== 'connected') return fail('DESKTOP_CONNECTION_FAILED');
    if (!inspection.task)
      return fail(
        inspection.code && inspection.code !== 'RECEIPT_PENDING' && inspection.code !== 'FILL_RESULT_UNKNOWN'
          ? inspection.code
          : 'HANDOFF_NOT_FOUND',
      );
    if (inspection.task.state === 'claimed' && inspection.task.fillStarted) return fail('DRAFT_ALREADY_CLAIMED');
    // Readiness is advisory; the fill operation can wait for the actual editor to mount.
    this.busy = true;
    this.change({ state: 'filling', stage: 'connecting', code: null });
    let claimed: BrowserCompanionHandoff | null = null;
    let writeIntent = false;
    let phase: 'claim' | 'media' | 'fill' = 'claim';
    try {
      if (this.page.waitReady) {
        phase = 'fill';
        this.change({ stage: 'waiting-editor' });
        if (!(await this.page.waitReady(site, inspection.task.contentKind))) {
          this.editorWaitStartedAt = Date.now() - COMPOSER_WAIT_MS;
          this.change({ state: 'failed', code: 'COMPOSER_NOT_FOUND' });
          return fail('COMPOSER_NOT_FOUND');
        }
      }
      phase = 'claim';
      this.change({ stage: 'connecting' });
      const claim = await sendCompanionRequest(site, {
        protocolVersion: BROWSER_COMPANION_PROTOCOL_VERSION,
        kind: 'claim-handoff',
        handoffId: request.handoffId,
        target: site,
      });
      if (claim.kind !== 'handoff') {
        const code = claim.kind === 'error' ? claim.code : 'HANDOFF_NOT_FOUND';
        this.change({ state: 'failed', code });
        return fail(code);
      }
      if (claim.handoff.handoffId !== request.handoffId || claim.handoff.target !== site) {
        this.change({ state: 'failed', code: 'TARGET_MISMATCH', task: null });
        return fail('TARGET_MISMATCH');
      }
      claimed = claim.handoff;
      const task = browserCompanionInspectionSchema.parse({
        handoffId: claimed.handoffId,
        target: site,
        state: 'claimed',
        contentKind: claimed.contentKind,
        title: claimed.title,
        text: claimed.text,
        media: claimed.media,
        createdAt: claimed.createdAt,
        fillStarted: false,
      });
      this.change({ task, connection: 'connected', stage: 'downloading' });
      phase = 'media';
      const files: File[] = [];
      for (const media of claimed.media) files.push(await downloadCompanionMedia(site, claimed, media));
      void this.preview(files, task);
      phase = 'fill';
      this.change({ stage: 'waiting-editor' });
      const fill = await this.page.fill(
        site,
        request.requestId,
        claimed,
        files,
        async () => {
          if (writeIntent) return;
          writeIntent = true;
          const started = await sendCompanionRequest(site, {
            protocolVersion: BROWSER_COMPANION_PROTOCOL_VERSION,
            kind: 'begin-fill',
            handoffId: claimed!.handoffId,
            completionToken: claimed!.completionToken,
          });
          if (started.kind !== 'fill-started' || started.handoffId !== claimed!.handoffId)
            throw new Error('Write intent was not acknowledged');
          this.change({ stage: 'writing', task: { ...task, fillStarted: true } });
        },
        (stage) => this.change({ stage }),
      );
      if (!fill.ok) {
        if (!writeIntent) await this.release(claimed);
        this.change({ state: writeIntent ? (claimed.media.length ? 'media' : 'unknown') : 'failed', code: fill.code });
        return fill;
      }
      this.pendingReceipt = claimed;
      this.change({ state: 'receipt', code: 'RECEIPT_PENDING', canRetryReceipt: true });
    } catch {
      if (claimed && !writeIntent) await this.release(claimed);
      const code =
        phase === 'claim' ? 'DESKTOP_CONNECTION_FAILED' : phase === 'media' ? 'MEDIA_DOWNLOAD_FAILED' : 'FILL_FAILED';
      this.change({
        state: writeIntent ? (claimed?.media.length ? 'media' : 'unknown') : phase === 'claim' ? 'offline' : 'failed',
        code,
        ...(phase === 'claim' ? { connection: 'offline' as const } : {}),
      });
      return fail(code);
    } finally {
      this.busy = false;
      this.change({ stage: 'idle' });
    }
    await this.retryReceipt(site, request.handoffId);
    return this.consumeResult(request.requestId, site);
  }

  private notifyDelivered(handoff: BrowserCompanionHandoff): void {
    try {
      this.page.delivered(handoff);
    } catch {
      /* Local UI cleanup cannot undo a committed receipt. */
    }
  }

  private consumeResult(requestId: string, site: CompanionSite): ConsumeHandoffResponse {
    return {
      ok: true,
      requestId,
      site,
      characterCount: [...(this.value.task?.text ?? '')].length,
      mediaCount: this.value.task?.media.length ?? 0,
      completion: this.value.state === 'delivered' ? 'completed' : 'failed',
    };
  }

  private async release(handoff: BrowserCompanionHandoff): Promise<void> {
    await sendCompanionRequest(handoff.target, {
      protocolVersion: BROWSER_COMPANION_PROTOCOL_VERSION,
      kind: 'release-handoff',
      handoffId: handoff.handoffId,
      completionToken: handoff.completionToken,
    }).catch(() => undefined);
  }
}

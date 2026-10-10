import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CaptureSelectionMessages } from '@/shared/i18n/capture-selection';

export const captureActionSchema = z.enum(['copy', 'pin', 'edit', 'annotate', 'export', 'record']);
export type CaptureActionResult = boolean | { image: Buffer };
export type CaptureAction = z.infer<typeof captureActionSchema>;
export const captureBoundsSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().min(2).max(32768),
    height: z.number().int().min(2).max(32768),
  })
  .strict();
export type CaptureBounds = z.infer<typeof captureBoundsSchema>;
export type CaptureActionHandler = (
  action: CaptureAction,
  image: Buffer,
  revision: number,
  bounds?: CaptureBounds,
  partial?: boolean,
  cursor?: boolean,
) => Promise<CaptureActionResult>;

/** One interactive capture can wait for user input while clipboard RPCs continue. */
export class CaptureSession {
  readonly id = randomUUID();
  private stopped = false;
  private working = false;
  private resolve!: () => void;
  private reject!: (reason: Error) => void;
  readonly done = new Promise<void>((resolve, reject) => {
    this.resolve = resolve;
    this.reject = reject;
  });

  constructor(
    private readonly labels: CaptureSelectionMessages,
    private readonly send: (command: object) => void,
    private readonly perform: CaptureActionHandler,
  ) {}

  async action(
    action: CaptureAction,
    image: Buffer,
    revision: number,
    bounds?: CaptureBounds,
    partial?: boolean,
    cursor?: boolean,
  ) {
    if (this.stopped || this.working) return;
    this.working = true;
    let close = false;
    let edited: string | undefined;
    let error = '';
    try {
      const result = await this.perform(action, image, revision, bounds, partial, cursor);
      if (typeof result === 'boolean') close = result;
      else edited = result.image.toString('base64');
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : 'storage';
      error = this.labels[code as keyof CaptureSelectionMessages] ?? this.labels.storage;
    }
    this.working = false;
    if (!this.stopped) this.send({ kind: 'capture-result', id: this.id, close, error, image: edited });
  }

  finish(error?: string | null) {
    if (this.stopped) return;
    this.stopped = true;
    if (error) this.reject(new Error(error));
    else this.resolve();
  }
}

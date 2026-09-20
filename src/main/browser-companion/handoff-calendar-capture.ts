import { randomUUID } from 'node:crypto';
import type { BrowserCompanionCalendarCapture } from '@/main/browser-companion/protocol';
import type { BrowserCompanionTarget } from '@/shared/contracts/browser-companion';

export type BrowserCompanionCalendarRecorder = (
  handoffId: string,
  target: BrowserCompanionTarget,
  capture: BrowserCompanionCalendarCapture,
) => boolean;

interface HandoffCalendarRecord {
  handoffId: string;
  target?: BrowserCompanionTarget;
  calendarCapture?: BrowserCompanionCalendarCapture;
}

/** Only header receipts cross from durable handoff state into the active library. */
export class HandoffCalendarCapture {
  private recorder?: BrowserCompanionCalendarRecorder;

  setRecorder(recorder: BrowserCompanionCalendarRecorder) {
    this.recorder = recorder;
  }

  capture(record: HandoffCalendarRecord) {
    const capture = record.calendarCapture;
    if (!capture?.events.length || !record.target) return;
    try {
      if (this.recorder?.(record.handoffId, record.target, capture)) capture.events = [];
    } catch (error) {
      // The handoff file already committed. Keep receipts for replay without
      // making a successful handoff look like a failed delivery.
      console.error('[browser-companion] calendar capture pending', error);
    }
  }

  append<T extends HandoffCalendarRecord>(
    record: T,
    operation: BrowserCompanionCalendarCapture['events'][number]['operation'],
    observedAt = new Date().toISOString(),
  ): T {
    this.capture(record);
    if (record.calendarCapture) {
      record.calendarCapture = {
        ...record.calendarCapture,
        events: [...record.calendarCapture.events, { id: randomUUID(), operation, observedAt }],
      };
    }
    return record;
  }
}

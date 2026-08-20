const transitionPickerTraceCapacity = 600;

export type TransitionPickerDiagnosticValue = string | number | boolean | null;
export type TransitionPickerDiagnosticDetails = Readonly<Record<string, TransitionPickerDiagnosticValue | undefined>>;
export type TransitionPickerDiagnosticSink = (name: string, details?: TransitionPickerDiagnosticDetails) => void;

export interface TransitionPickerDiagnosticEvent {
  sequence: number;
  sessionId: string;
  name: string;
  elapsedMs: number;
  details?: Readonly<Record<string, TransitionPickerDiagnosticValue>>;
}

interface TransitionPickerDiagnosticSession {
  id: string;
  startedAt: number;
  startedAtIso: string;
  longTaskObserver: PerformanceObserver | null;
}

interface TransitionPickerDiagnosticStatus {
  active: boolean;
  sessionId: string | null;
  startedAtIso: string | null;
  eventCount: number;
  droppedEventCount: number;
}

interface TransitionPickerDiagnosticApi {
  read(): TransitionPickerDiagnosticEvent[];
  clear(): void;
  dump(): void;
  status(): TransitionPickerDiagnosticStatus;
}

type TransitionPickerDiagnosticWindow = Window & {
  __AIY_TRANSITION_PICKER_TRACE__?: TransitionPickerDiagnosticApi;
};

const diagnosticsEnabled = import.meta.env.DEV && typeof window !== 'undefined';
const events: TransitionPickerDiagnosticEvent[] = [];
let activeSession: TransitionPickerDiagnosticSession | null = null;
let droppedEventCount = 0;
let nextSequence = 0;
let nextSessionOrdinal = 0;

function rounded(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizedDetails(details?: TransitionPickerDiagnosticDetails) {
  if (!details) return undefined;
  const normalized: Record<string, TransitionPickerDiagnosticValue> = {};
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined) continue;
    normalized[key] = typeof value === 'number' && !Number.isInteger(value) ? rounded(value) : value;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function appendEvent(
  session: TransitionPickerDiagnosticSession,
  name: string,
  details?: TransitionPickerDiagnosticDetails,
) {
  const nextEvent: TransitionPickerDiagnosticEvent = {
    sequence: ++nextSequence,
    sessionId: session.id,
    name,
    elapsedMs: rounded(performance.now() - session.startedAt),
    details: normalizedDetails(details),
  };
  events.push(nextEvent);
  if (events.length > transitionPickerTraceCapacity) {
    const removeCount = events.length - transitionPickerTraceCapacity;
    events.splice(0, removeCount);
    droppedEventCount += removeCount;
  }
}

function createLongTaskObserver(session: TransitionPickerDiagnosticSession) {
  if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    return null;
  }
  try {
    const observer = new PerformanceObserver((list) => {
      if (activeSession?.id !== session.id) return;
      for (const entry of list.getEntries()) {
        appendEvent(session, 'main-thread.long-task', {
          durationMs: entry.duration,
          startedAfterOpenMs: entry.startTime - session.startedAt,
        });
      }
    });
    observer.observe({ type: 'longtask' });
    return observer;
  } catch {
    return null;
  }
}

export const transitionPickerDiagnosticSink: TransitionPickerDiagnosticSink | undefined = diagnosticsEnabled
  ? (name, details) => {
      if (activeSession) appendEvent(activeSession, name, details);
    }
  : undefined;

export function beginTransitionPickerDiagnosticSession(details?: TransitionPickerDiagnosticDetails) {
  if (!diagnosticsEnabled) return undefined;
  if (activeSession) {
    appendEvent(activeSession, 'picker.close', { reason: 'superseded' });
    activeSession.longTaskObserver?.disconnect();
  }

  const session: TransitionPickerDiagnosticSession = {
    id: `picker-${++nextSessionOrdinal}`,
    startedAt: performance.now(),
    startedAtIso: new Date().toISOString(),
    longTaskObserver: null,
  };
  activeSession = session;
  appendEvent(session, 'picker.open', { startedAtIso: session.startedAtIso, ...(details ?? {}) });
  session.longTaskObserver = createLongTaskObserver(session);
  console.info(
    `[transition-picker] ${session.id} tracing started; inspect window.__AIY_TRANSITION_PICKER_TRACE__.read()`,
  );

  return () => {
    if (activeSession?.id !== session.id) return;
    appendEvent(session, 'picker.close', { reason: 'dialog-closed' });
    session.longTaskObserver?.disconnect();
    activeSession = null;
    console.info(`[transition-picker] ${session.id} tracing stopped with ${events.length} buffered events`);
  };
}

const diagnosticApi: TransitionPickerDiagnosticApi = {
  read: () =>
    events.map((event) => ({
      ...event,
      details: event.details ? { ...event.details } : undefined,
    })),
  clear: () => {
    events.length = 0;
    droppedEventCount = 0;
  },
  dump: () => {
    console.table(
      events.map((event) => ({
        sequence: event.sequence,
        sessionId: event.sessionId,
        elapsedMs: event.elapsedMs,
        name: event.name,
        details: event.details ? JSON.stringify(event.details) : '',
      })),
    );
  },
  status: () => ({
    active: activeSession !== null,
    sessionId: activeSession?.id ?? null,
    startedAtIso: activeSession?.startedAtIso ?? null,
    eventCount: events.length,
    droppedEventCount,
  }),
};

if (diagnosticsEnabled) {
  Object.defineProperty(window as TransitionPickerDiagnosticWindow, '__AIY_TRANSITION_PICKER_TRACE__', {
    configurable: true,
    value: diagnosticApi,
  });
}

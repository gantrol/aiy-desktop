export type CodexTurnTimeoutKind = 'ABSOLUTE' | 'IDLE';

export function codexTurnTimeoutError(kind: CodexTurnTimeoutKind) {
  return Object.assign(
    new Error(
      kind === 'IDLE' ? 'Codex App Server turn became inactive and timed out' : 'Codex App Server turn timed out',
    ),
    {
      code:
        kind === 'IDLE' ? ('CODEX_APP_SERVER_TURN_IDLE_TIMEOUT' as const) : ('CODEX_APP_SERVER_TURN_TIMEOUT' as const),
      retryable: true,
    },
  );
}

export class CodexTurnTimeouts {
  private absoluteTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly absoluteTimeoutMs: number,
    private readonly idleTimeoutMs: number | null,
    private readonly onTimeout: (kind: CodexTurnTimeoutKind) => void,
  ) {}

  start() {
    this.clear();
    this.absoluteTimer = setTimeout(() => this.onTimeout('ABSOLUTE'), this.absoluteTimeoutMs);
    this.renewActivity();
  }

  renewActivity() {
    if (this.idleTimeoutMs === null) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.onTimeout('IDLE'), this.idleTimeoutMs);
  }

  clear() {
    if (this.absoluteTimer) clearTimeout(this.absoluteTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.absoluteTimer = null;
    this.idleTimer = null;
  }
}

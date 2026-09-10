import { useI18n } from '@/renderer/i18n/useI18n';
import { useCodexNoteContent } from '@/renderer/features/extensions/codex-content/CodexNoteContext';
import type { PetalSignal } from '@/renderer/features/desktop-petals/PetalShape';

export function useCodexAgentSignal(): PetalSignal | undefined {
  const copy = useI18n().messages.desktopPetals.codex;
  const { state, error, available } = useCodexNoteContent();
  const task = state?.tasks[0];
  if (!available || (!task && !error)) return undefined;
  const active = Boolean(task && ['STARTING', 'RUNNING', 'COLLECTING'].includes(task.status));
  const failed = Boolean(error || task?.status === 'FAILED' || task?.status === 'COLLECTION_FAILED');
  const label = error
    ? copy.agent.unavailable
    : task?.status === 'RUNNING'
      ? copy.agent[task.activity ?? 'thinking']
      : task
        ? copy.status[task.status]
        : copy.agent.idle;
  const color = failed
    ? 'var(--destructive)'
    : task?.status === 'COMPLETED'
      ? 'var(--success)'
      : task?.status === 'INTERRUPTED'
        ? 'var(--warning)'
        : task?.status === 'RUNNING'
          ? task.activity === 'working'
            ? 'var(--primary)'
            : 'var(--info)'
          : 'var(--warning)';
  return { label, color, active: active && !failed };
}

/** A compact status light shares the petal rim's activity and color. */
export function CodexAgentLight() {
  const signal = useCodexAgentSignal();
  if (!signal) return null;
  return (
    <span
      role="status"
      title={signal.label}
      aria-label={signal.label}
      className="inline-flex size-3 shrink-0 items-center justify-center"
    >
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full${signal.active ? ' motion-safe:animate-pulse' : ''}`}
        style={{ backgroundColor: signal.color }}
      />
    </span>
  );
}

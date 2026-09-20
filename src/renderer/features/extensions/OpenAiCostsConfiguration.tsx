import { useEffect, useRef, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { OpenAiCostsConnectionStatus } from '@/shared/openai-costs';

export function OpenAiCostsConfiguration({ active }: { active: boolean }) {
  const { messages } = useI18n();
  const m = messages.calendar;
  const [status, setStatus] = useState<OpenAiCostsConnectionStatus | null>(null);
  const [adminKey, setAdminKey] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const request = ++generation.current;
    setAdminKey('');
    setStatus(null);
    setOrganizationId('');
    setError(false);
    setBusy(false);
    setLoading(active);
    if (active)
      void window.desktopApi.openAiCostsConnection.status().then(
        (value) => {
          if (request === generation.current) {
            setStatus(value);
            setOrganizationId(value.organizationId ?? '');
            setLoading(false);
          }
        },
        () => {
          if (request === generation.current) {
            setError(true);
            setLoading(false);
          }
        },
      );
    return () => {
      generation.current += 1;
    };
  }, [active]);
  async function save(clear: boolean) {
    if (busy || loading || !active) return;
    const request = ++generation.current;
    setBusy(true);
    setError(false);
    try {
      const next = clear
        ? await window.desktopApi.openAiCostsConnection.clear()
        : await window.desktopApi.openAiCostsConnection.save({
            adminKey,
            organizationId: organizationId.trim() || null,
          });
      if (request !== generation.current) return;
      setStatus(next);
      setAdminKey('');
      setOrganizationId(next.organizationId ?? '');
    } catch {
      if (request === generation.current) setError(true);
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  return (
    <section className="grid gap-4 rounded-lg border p-4" aria-label={m.openAiCostsTitle}>
      <h3 className="text-sm font-semibold">{m.openAiCostsTitle}</h3>
      <p className="text-xs leading-relaxed text-muted-foreground">{m.openAiAdminHint}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">{m.openAiCostsGlobal}</p>
      <label className="grid gap-1.5 text-xs text-foreground-secondary">
        {m.openAiAdminKey}
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          maxLength={500}
          disabled={busy || loading || !active}
          value={adminKey}
          onChange={(event) => setAdminKey(event.target.value)}
        />
      </label>
      <label className="grid gap-1.5 text-xs text-foreground-secondary">
        {m.openAiOrganization}
        <Input
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
          disabled={busy || loading || !active}
          value={organizationId}
          onChange={(event) => setOrganizationId(event.target.value)}
        />
      </label>
      {status && (
        <p role="status" className="text-xs text-muted-foreground">
          {status.configured
            ? status.state === 'ERROR'
              ? m.openAiCostsError
              : m.openAiCostsSaved
            : m.openAiCostsUnconfigured}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {m.openAiCostsError} {m.openAiCostsPermission}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {status?.configured && (
          <Button variant="ghost" disabled={busy || loading || !active} onClick={() => void save(true)}>
            {m.openAiCostsClear}
          </Button>
        )}
        <Button
          disabled={busy || loading || !active || (!adminKey.trim() && !status?.configured)}
          onClick={() => void save(false)}
        >
          {busy ? m.saving : m.save}
        </Button>
      </div>
    </section>
  );
}

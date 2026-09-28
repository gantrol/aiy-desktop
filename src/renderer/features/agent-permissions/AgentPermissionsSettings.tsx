import { useEffect, useState } from 'react';
import {
  agentPermissionKeys,
  deniedAgentPermissions,
  type AgentPermissions,
} from '@/shared/contracts/agent-permissions';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Label } from '@/renderer/components/ui/label';
import { useI18n } from '@/renderer/i18n/useI18n';

export function AgentPermissionsSettings() {
  const { messages } = useI18n();
  const l = messages.agentPermissions;
  const [policy, setPolicy] = useState<AgentPermissions | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setPolicy(null);
    setFailed(false);
    setSaved(false);
    void window.desktopApi.agentPermissions
      .read()
      .then((value) => {
        if (active) setPolicy(value);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [reload]);
  async function save() {
    if (!policy || busy) return;
    setBusy(true);
    setFailed(false);
    setSaved(false);
    try {
      setPolicy(await window.desktopApi.agentPermissions.save(policy));
      setSaved(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-4">
      {policy && (
        <>
          <div className="grid gap-1 text-xs text-muted-foreground">
            <Label>{l.space}</Label>
            <span className="break-all font-mono">{policy.spaceId}</span>
          </div>
          <div className="grid gap-3">
            {agentPermissionKeys.map((permission) => (
              <Label key={permission} className="flex items-center justify-between gap-4 font-normal">
                {l[permission]}
                <Checkbox
                  checked={policy.grants[permission]}
                  disabled={busy}
                  onCheckedChange={(checked) => {
                    setPolicy({ ...policy, grants: { ...policy.grants, [permission]: checked === true } });
                    setSaved(false);
                  }}
                />
              </Label>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 border-t pt-3">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setPolicy({ ...policy, grants: deniedAgentPermissions() });
                setSaved(false);
              }}
            >
              {l.revokeAll}
            </Button>
            <Button disabled={busy} onClick={() => void save()}>
              {l.save}
            </Button>
          </div>
        </>
      )}
      {!policy && !failed && (
        <span role="status" className="text-sm text-muted-foreground">
          {l.loading}
        </span>
      )}
      {saved && (
        <span role="status" className="text-sm text-muted-foreground">
          {l.saved}
        </span>
      )}
      {failed && (
        <div className="grid gap-2">
          <span role="alert" className="text-sm text-destructive">
            {l.failed}
          </span>
          <Button variant="outline" disabled={busy} onClick={() => setReload((value) => value + 1)}>
            {l.reload}
          </Button>
        </div>
      )}
    </div>
  );
}

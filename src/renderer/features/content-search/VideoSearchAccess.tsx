import { useEffect, useRef, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ExtensionDto } from '@/shared/contracts';
import { IMAGE_SEARCH_EXTENSION_ID } from '@/shared/extension-ids';
import { EXTENSION_PERMISSION } from '@/shared/extension-permissions';
import { extensionPermissionInfo } from '@/shared/extension-permission-info';

/** Settings retain explicit access grants; entering search never changes permissions. */
export function VideoSearchAccess({ active }: { active: boolean }) {
  const { messages } = useI18n();
  const copy = messages.imageSearch;
  const [extension, setExtension] = useState<ExtensionDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const lifecycle = useRef({ epoch: 0 });
  const applying = useRef(false);
  const missing =
    extension?.permissions.filter(
      (permission) =>
        !permission.granted && (permission.required || permission.key === EXTENSION_PERMISSION.libraryReadActiveVideos),
    ) ?? [];
  const declared = extension?.permissions.some(
    (permission) => permission.key === EXTENSION_PERMISSION.libraryReadActiveVideos,
  );
  const ready = Boolean(
    active && !busy && !failed && extension?.enabled && extension.compatible && declared && !missing.length,
  );
  useEffect(() => {
    if (!active) return;
    const state = lifecycle.current;
    const ticket = ++state.epoch;
    setExtension(null);
    setBusy(true);
    setFailed(false);
    void window.desktopApi
      .extensionsList()
      .then((items) => {
        if (ticket === state.epoch)
          setExtension(items.find((item) => item.manifest.id === IMAGE_SEARCH_EXTENSION_ID) ?? null);
      })
      .catch(() => {
        if (ticket === state.epoch) setFailed(true);
      })
      .finally(() => {
        if (ticket === state.epoch) setBusy(false);
      });
    return () => {
      state.epoch++;
    };
  }, [active, revision]);
  const change = async (operation: () => Promise<ExtensionDto[]>) => {
    if (applying.current || busy) return;
    applying.current = true;
    const state = lifecycle.current;
    const ticket = ++state.epoch;
    setBusy(true);
    setFailed(false);
    try {
      const items = await operation();
      if (ticket === state.epoch)
        setExtension(items.find((item) => item.manifest.id === IMAGE_SEARCH_EXTENSION_ID) ?? null);
    } catch {
      if (ticket === state.epoch) setFailed(true);
    } finally {
      applying.current = false;
      if (ticket === state.epoch) setBusy(false);
    }
  };
  if (ready) return null;
  return (
    <div className="flex flex-col gap-2" aria-busy={busy}>
      {busy && !extension && (
        <span role="status" className="text-xs text-muted-foreground">
          {messages.referenceOutline.lookup.searching}
        </span>
      )}
      {extension && !extension.enabled && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void change(() =>
              window.desktopApi.extensionSetEnabled({ extensionId: IMAGE_SEARCH_EXTENSION_ID, enabled: true }),
            )
          }
        >
          {copy.videos.enable}
        </Button>
      )}
      {missing.map((permission) => (
        <div key={permission.key} className="flex items-center justify-between gap-3">
          <span className="text-sm">
            {messages.extensionManager.names[extensionPermissionInfo(permission.key).name]}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void change(() =>
                window.desktopApi.extensionSetPermission({
                  extensionId: IMAGE_SEARCH_EXTENSION_ID,
                  permission: permission.key,
                  granted: true,
                }),
              )
            }
          >
            {messages.extensionManager.allow}
          </Button>
        </div>
      ))}
      {!busy && (failed || !extension || !extension.compatible || !declared) && (
        <div className="flex items-center justify-between gap-3">
          <span role="alert" className="text-sm text-destructive">
            {copy.UNAVAILABLE}
          </span>
          <Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>
            {messages.referenceOutline.lookup.retry}
          </Button>
        </div>
      )}
    </div>
  );
}

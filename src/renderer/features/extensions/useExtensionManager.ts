import { useEffect, useRef, useState } from 'react';
import type { ExtensionDto } from '@/shared/contracts';
import type { NavigationMode } from '@/renderer/components/app/app-navigation';
import { publishLanguagePluginState } from '@/renderer/i18n/languagePluginState';
import { useI18n } from '@/renderer/i18n/useI18n';
import { firstGroupedExtensionId } from '@/renderer/features/extensions/extensionPluginGroups';

interface Options {
  initial: readonly ExtensionDto[];
  requestedId: string | null;
  onSelectedIdChange(id: string, mode?: NavigationMode): void;
  onExtensionsChange(): void;
  notify(message: string): void;
}

/** One mutation at a time. Refreshes never win over a newer mutation or selection. */
export function useExtensionManager(options: Options) {
  const { messages } = useI18n();
  const [extensions, setExtensions] = useState<ExtensionDto[]>(() => [...options.initial]);
  const [selectedId, setSelectedId] = useState(() =>
    options.requestedId && options.initial.some((item) => item.manifest.id === options.requestedId)
      ? options.requestedId
      : firstGroupedExtensionId(options.initial),
  );
  const [busyKey, setBusyKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const mutation = useRef(false);
  const epoch = useRef(0);
  const selected = useRef(selectedId);
  const callbacks = useRef(options);
  callbacks.current = options;
  const initial = useRef(options.initial);
  const appliedRequest = useRef<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      epoch.current += 1;
    };
  }, []);
  useEffect(() => {
    if (initial.current === options.initial) return;
    initial.current = options.initial;
    epoch.current += 1;
    setLoading(false);
    setExtensions([...options.initial]);
    if (!options.initial.some((item) => item.manifest.id === selected.current)) {
      selected.current = firstGroupedExtensionId(options.initial);
      setSelectedId(selected.current);
    }
  }, [options.initial]);
  useEffect(() => {
    if (options.requestedId === null) {
      appliedRequest.current = null;
      return;
    }
    if (appliedRequest.current === options.requestedId) return;
    if (!options.requestedId || !extensions.some((item) => item.manifest.id === options.requestedId)) return;
    appliedRequest.current = options.requestedId;
    selected.current = options.requestedId;
    setSelectedId(options.requestedId);
  }, [options.requestedId, extensions]);

  function select(id: string, mode?: NavigationMode) {
    selected.current = id;
    setSelectedId(id);
    if (id) callbacks.current.onSelectedIdChange(id, mode);
  }
  function apply(next: ExtensionDto[]) {
    setExtensions(next);
    publishLanguagePluginState(next);
    if (!next.some((item) => item.manifest.id === selected.current)) select(firstGroupedExtensionId(next), 'replace');
  }
  async function load() {
    if (!alive.current || mutation.current) return;
    const ticket = ++epoch.current;
    setLoading(true);
    try {
      // State inspection does not start an unrelated model connection or network probe.
      const next = await window.desktopApi.extensionsList();
      if (alive.current && ticket === epoch.current) {
        apply(next);
        setError('');
      }
    } catch (reason) {
      if (alive.current && ticket === epoch.current)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (alive.current && ticket === epoch.current) setLoading(false);
    }
  }
  async function mutate(key: string, run: () => Promise<ExtensionDto[]>, message: string) {
    if (!alive.current || mutation.current) return false;
    mutation.current = true;
    const ticket = ++epoch.current;
    setLoading(false);
    setBusyKey(key);
    setError('');
    try {
      const next = await run();
      if (!alive.current || ticket !== epoch.current) return false;
      apply(next);
      callbacks.current.onExtensionsChange();
      if (message) callbacks.current.notify(message);
      return true;
    } catch (reason) {
      if (alive.current && ticket === epoch.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
        // A failed native/file operation may still have safely revoked access.
        callbacks.current.onExtensionsChange();
      }
      return false;
    } finally {
      mutation.current = false;
      if (alive.current) setBusyKey('');
    }
  }
  async function install(message: string) {
    let installedId: string | null = null;
    const ok = await mutate(
      'install',
      async () => {
        const result = await window.desktopApi.extensionInstallLocal();
        installedId = result.extensionId;
        return result.extensions;
      },
      '',
    );
    if (ok && installedId && alive.current) {
      select(installedId);
      callbacks.current.notify(message);
    }
    return ok && Boolean(installedId);
  }
  async function update(extensionId: string, message: string) {
    let updated = false;
    const ok = await mutate(
      `update:${extensionId}`,
      async () => {
        const result = await window.desktopApi.extensionUpdateLocal(extensionId);
        if (result.errorCode) throw new Error(messages.extensions.updateErrors[result.errorCode]);
        updated = result.extensionId !== null;
        return result.extensions;
      },
      '',
    );
    if (ok && updated && alive.current) callbacks.current.notify(message);
    return ok && updated;
  }
  return {
    extensions,
    selectedId,
    busyKey,
    loading,
    error,
    select,
    load,
    mutate,
    install,
    update,
    refresh: (message: string) => mutate('reload', () => window.desktopApi.extensionsReload(), message),
    clearError: () => setError(''),
  };
}

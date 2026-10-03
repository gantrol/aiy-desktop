import type { DesktopApi } from '@/shared/contracts';

/** Only the editor's read/recovery/event boundary is supplied. Unknown desktop actions reject. */
export function installArticlePreviewHost(unavailable: string) {
  const previous = Object.getOwnPropertyDescriptor(window, 'desktopApi');
  if (previous?.value) throw new Error('Article stories must run in an isolated preview without a desktop bridge');
  const api = {
    appPlatform: 'win32',
    rendererDiagnosticRecord: async () => undefined,
    articleEditorRecoveryList: async () => [],
    articleEditorRecoveryWrite: async () => undefined,
    articleEditorRecoveryRemove: async () => undefined,
    articleDeliveryJobsList: async () => [],
    onArticleEditorDrain: () => () => undefined,
    onArticleDeliveryJobChanged: () => () => undefined,
    onAssetFilesDragFinished: () => () => undefined,
  } satisfies Partial<DesktopApi>;
  const bridge = new Proxy(api, {
    get(target, key) {
      if (key in target) return target[key as keyof typeof target];
      // This optional service is absent, rather than pretending author data was loaded.
      if (key === 'me') return undefined;
      return () => Promise.reject(new Error(unavailable));
    },
  });
  Object.defineProperty(window, 'desktopApi', { configurable: true, value: bridge });
  return () => {
    if (!Object.is(window.desktopApi, bridge)) return;
    if (previous) Object.defineProperty(window, 'desktopApi', previous);
    else Reflect.deleteProperty(window, 'desktopApi');
  };
}

/** The editor's existing preference keys are temporarily scoped to this single preview document. */
export function isolateArticlePreferences(spaceId: string) {
  const keys = ['aiy.article-editor-outline.v1', 'aiy.article-editor-outline-secondary.v1'];
  let values: (string | null)[];
  try {
    values = keys.map((key) => localStorage.getItem(key));
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // The product also permits an editor session when browser storage is unavailable.
    return () => undefined;
  }
  return () => {
    try {
      keys.forEach((key, index) => {
        const value = values[index];
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      });
      const recoveryPrefix = `aiy.article-editor-recovery.v1:${encodeURIComponent(spaceId)}:`;
      const outlineKey = `aiy.outline-view.v1:${JSON.stringify([spaceId, 'storybook-article'])}`;
      const storedKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
      for (const key of storedKeys) {
        if (key?.startsWith(recoveryPrefix) || key === outlineKey) localStorage.removeItem(key);
      }
    } catch {
      // Storage may become unavailable after the preview was mounted.
    }
  };
}

import { Component, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Undo2 } from 'lucide-react';
import { StickyNote } from '@/renderer/features/desktop-petals/StickyNote';
import { RoseFlower } from '@/renderer/features/desktop-petals/RoseFlower';
import { I18nContext } from '@/renderer/i18n/I18nContext';
import { hydrateLanguageCatalog } from '@/renderer/i18n/languageCatalog';
import { enMessages } from '@/renderer/i18n/locales/en';
import { htmlLanguages } from '@/renderer/i18n/catalog';
import zhMessages from '../../../../../../extensions/com.aiy.language.zh-cn/messages.json';
import {
  desktopNoteSchema,
  desktopPetalSnapshotSchema,
  type DesktopPetalsApi,
} from '@/shared/contracts/desktop-petals';
import type { DesktopApi, Locale } from '@/shared/contracts';
import {
  DEMO_CHANNEL,
  demoRoles,
  type DemoHostMessage,
  type DemoRole,
  type DemoTarget,
  type DemoWindowDetail,
} from '@/renderer/features/extensions/feature-demo/v050/demoProtocol';
import { demoMedia } from '@/renderer/features/extensions/feature-demo/v050/demoMedia';
import {
  demoDefaultTargets,
  demoFlowerCenter,
  demoFlowerFoldAt,
} from '@/renderer/features/extensions/feature-demo/v050/demoDesktopScene';
import { DemoWorkspaceWindow } from '@/renderer/features/extensions/feature-demo/v050/DemoWorkspaceWindow';
import { DEMO_DURATION, demoCues } from '@/renderer/features/extensions/feature-demo/v050/demoTimeline';

const catalogs = { en: enMessages, zh: hydrateLanguageCatalog(zhMessages, enMessages) };
const params = new URLSearchParams(location.search);
const locale: Locale = params.get('locale') === 'en' ? 'en' : 'zh';
const requestedRole = params.get('role');
const role: DemoRole = demoRoles.find((item) => item === requestedRole) ?? 'note';
const token = params.get('token') ?? '';
const messages = catalogs[locale];
const noop = async () => {};
const unsupported = async () => {
  throw new Error(messages.extensions.featureDemo.v050.unavailable);
};
const unsubscribe = () => () => {};

function createDemoSession() {
  const note = desktopNoteSchema.parse({
    id: 'demo-note',
    stashId: 'demo-stash',
    text: `![AIY](${new URL(demoMedia.character, location.href).href})`,
    format: 'markdown',
    title: messages.extensions.featureDemo.v050.noteText,
    editable: true,
    persisted: false,
    contentHash: 'demo-initial',
    revisionId: null,
    color: 'rose',
    icon: 'feather',
    references: [],
  });
  let snapshot = desktopPetalSnapshotSchema.parse({
    libraryId: 'demo',
    libraryName: 'AIY',
    instanceId: note.id,
    point: { x: 0, y: 0 },
    notes: [note],
    draft: null,
    expanded: role === 'note',
    suspended: false,
    flowerAnchor: { x: 56, y: 56 },
    contentApplications: [
      { id: 'codex.content', extensionId: 'com.aiy.codex', name: 'Codex', available: false, missingPermissions: [] },
    ],
  });
  const listeners = new Set<() => void>();
  const menuListeners = new Set<() => void>();
  const status = new Set<'ready' | 'motion-ready' | 'failed'>();
  const targets = new Map<DemoTarget, Extract<DemoWindowDetail, { type: 'target' }>>();
  const publish = (patch: Partial<typeof snapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  };
  const notify = (detail: DemoWindowDetail) => {
    if (detail.type === 'target') targets.set(detail.target, detail);
    else status.add(detail.type);
    // File-backed Electron documents have an opaque origin; the host verifies source and per-run token.
    parent.postMessage({ channel: DEMO_CHANNEL, token, role, ...detail }, '*');
  };
  const patchNote = (patch: object) => {
    const next = { ...snapshot.notes[0]!, ...patch, contentHash: crypto.randomUUID() };
    publish({ notes: [next] });
    return next;
  };
  const api = {
    checkpoint: noop,
    save: async ({ text, title, document, format }: Parameters<DesktopPetalsApi['save']>[0]) =>
      patchNote({ text, title: title ?? snapshot.notes[0]!.title, document, format }),
    onFlush: unsubscribe,
    onMenuRequested: (listener: () => void) => {
      menuListeners.add(listener);
      return () => {
        menuListeners.delete(listener);
      };
    },
    onPluckPointer: unsubscribe,
    onDrawerFrame: unsubscribe,
    onDrawerPointer: unsubscribe,
    onTitlesChanged: unsubscribe,
    setMenuOpen: async (_open: boolean, point?: { x: number; y: number }) => {
      const center = demoFlowerCenter(demoCues.menuOpen);
      return point ?? { x: center[0], y: center[1] };
    },
    openMain: noop,
    expand: async (expanded: boolean) => {
      publish({ expanded });
    },
    appearance: async ({ color, icon }: Parameters<DesktopPetalsApi['appearance']>[0]) =>
      patchNote({ ...(color && { color }), ...(icon && { icon }) }),
    albums: async () => [],
    setAlbum: async ({ albumId }: { albumId: string | null }) => patchNote({ albumId }),
    setAlwaysOnTop: async (alwaysOnTop: boolean) => publish({ alwaysOnTop }),
    preview: async () => null,
    previewFrame: noop,
    externalApplications: { list: async () => snapshot.contentApplications, command: unsupported },
    contentLibrary: { search: async () => ({ items: [], nextOffset: null }), read: unsupported },
    codex: { state: async () => null, onChanged: unsubscribe },
    references: async ({ kind }: { kind: string }) => (kind === 'search' ? [] : unsupported()),
    files: unsupported,
    resize: unsupported,
    beginDrag: noop,
    move: noop,
    endDrag: noop,
  };
  return {
    api: new Proxy(api, {
      get: (target, key) => Reflect.get(target, key) ?? unsupported,
    }) as unknown as DesktopPetalsApi,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish,
    notify,
    reportStatus: () => {
      if (status.has('failed')) {
        notify({ type: 'failed' });
        return;
      }
      for (const type of status) notify({ type });
      for (const target of targets.values()) notify(target);
    },
    requestMenu: () => menuListeners.forEach((listener) => listener()),
  };
}

// The preview runs in its own subframe. Never replace the real application's IPC bridge.
const isolated = window.parent !== window && !window.desktopPetals && !window.desktopApi && token.length > 0;
const session = isolated ? createDemoSession() : null;
if (session) window.desktopPetals = session.api;
if (session && role === 'workspace') {
  // Only a local empty destination catalogue; all other application actions are rejected.
  const api = {
    browserCompanionDestinations: async () => ({
      browsers: [],
      routes: { chatgpt: null, wechat: null, weibo: null, x: null, xiaohongshu: null },
    }),
  } satisfies Pick<DesktopApi, 'browserCompanionDestinations'>;
  window.desktopApi = new Proxy(api, {
    get: (target, key) => Reflect.get(target, key) ?? unsupported,
  }) as unknown as DesktopApi;
}

function DemoContent({ session: current }: { session: NonNullable<typeof session> }) {
  const snapshot = useSyncExternalStore(current.subscribe, current.getSnapshot);
  const [time, setTime] = useState(0);
  useEffect(() => {
    const receive = (event: MessageEvent<DemoHostMessage>) => {
      if (
        event.source !== parent ||
        event.data?.channel !== DEMO_CHANNEL ||
        event.data.token !== token ||
        event.data.role !== role
      )
        return;
      if (event.data.type === 'status-request') current.reportStatus();
      if (
        event.data.type === 'snapshot' &&
        typeof event.data.collected === 'boolean' &&
        Number.isFinite(event.data.time) &&
        event.data.time >= 0 &&
        event.data.time <= DEMO_DURATION
      ) {
        setTime(event.data.time);
        if (Boolean(current.getSnapshot().collectionUndo) !== event.data.collected)
          current.publish({
            collectionUndo: event.data.collected ? { token, expiresAt: Number.MAX_SAFE_INTEGER } : null,
          });
      }
    };
    window.addEventListener('message', receive);
    if (role !== 'workspace') current.notify({ type: 'ready' });
    return () => window.removeEventListener('message', receive);
  }, [current]);
  useLayoutEffect(() => {
    if (role === 'workspace') return;
    let live = true;
    const measure = () => {
      if (!live) return;
      const target =
        role === 'note'
          ? [...document.querySelectorAll<HTMLButtonElement>('button')].find(
              (button) => button.getAttribute('aria-label') === messages.desktopPetals.note.collapse,
            )
          : null;
      if (target) {
        const bounds = target.getBoundingClientRect();
        current.notify({
          type: 'target',
          target: role,
          point: [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2],
        });
      } else if (role !== 'note') current.notify({ type: 'target', target: role, point: demoDefaultTargets[role] });
    };
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    void document.fonts.ready.then(measure);
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [current]);
  if (role === 'workspace')
    return (
      <DemoWorkspaceWindow time={time} snapshot={snapshot} requestMenu={current.requestMenu} notify={current.notify} />
    );
  const fold = demoFlowerFoldAt(time);
  return role === 'flower' ? (
    <div className="absolute inset-2 origin-center" style={{ transform: `scale(${1 + fold * 0.5})` }}>
      <RoseFlower
        size={208}
        fold={fold}
        onPluck={async () => false}
        onPreview={noop}
        onCenterClick={snapshot.collectionUndo ? noop : undefined}
        centerLabel={snapshot.collectionUndo ? messages.desktopPetals.actions.undoCollection : undefined}
        center={snapshot.collectionUndo ? <Undo2 className="size-6" /> : undefined}
      />
    </div>
  ) : (
    <StickyNote initialNote={snapshot.notes[0]!} snapshot={snapshot} />
  );
}

class DemoFrameBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    session?.notify({ type: 'failed' });
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function DemoPetalWindow() {
  const language = useMemo(() => ({ locale, messages, availableLocales: [locale], setLocale() {} }), []);
  useEffect(() => {
    document.documentElement.lang = htmlLanguages[locale];
    // Also covers portaled menus: playback never steals keyboard focus from the host controls.
    document.body.inert = true;
  }, []);
  return (
    <I18nContext.Provider value={language}>
      <DemoFrameBoundary>
        {session ? (
          // Timeline owns motion; the real note and petal stay mounted at fixed native sizes.
          <div inert className="contents [&_.sticky-note]:animate-none">
            <DemoContent session={session} />
          </div>
        ) : (
          <span role="alert">{messages.extensions.featureDemo.v050.unavailable}</span>
        )}
      </DemoFrameBoundary>
    </I18nContext.Provider>
  );
}

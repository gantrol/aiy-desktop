import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Minus,
  PackagePlus,
  Power,
  RefreshCw,
  Square,
  X,
} from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { AppSidebar } from '@/renderer/components/app/AppSidebar';
import { AiyIdentity } from '@/renderer/components/brand/AiyIdentity';
import { Button } from '@/renderer/components/ui/button';
import { Slider } from '@/renderer/components/ui/slider';
import { Tabs, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { TrayMenuItems } from '@/renderer/features/app-shell/TrayMenuItems';
import { appearanceStyle } from '@/renderer/features/desktop-petals/petal-appearance';
import { petalMenuSurfaceClass } from '@/renderer/features/desktop-petals/petal-menu-style';
import { ExtensionPluginHeader } from '@/renderer/features/extensions/ExtensionPluginHeader';
import { ExtensionPluginList } from '@/renderer/features/extensions/ExtensionPluginList';
import { DemoPlaybackControls } from '@/renderer/features/extensions/feature-demo/v050/DemoPlaybackControls';
import { demoNoop } from '@/renderer/features/extensions/feature-demo/v050/demoCreationData';
import { demoOutroCues } from '@/renderer/features/extensions/feature-demo/v050/demoOutroTimeline';
import { demoOutroMedia } from '@/renderer/features/extensions/feature-demo/v050/demoOutroMedia';
import {
  DEMO_DURATION,
  DEMO_FPS,
  demoChapterAt,
  demoChapters,
  demoCues,
} from '@/renderer/features/extensions/feature-demo/v050/demoTimeline';
import {
  demoExitLayout,
  type DemoExitPreview,
  type DemoExitTargets,
} from '@/renderer/features/extensions/feature-demo/v050/demoExitScene';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import type { ExtensionDto } from '@/shared/contracts';
import demoManifest from '../../../../../../extensions/com.aiy.feature-demo/manifest.json';
import watermarkManifest from '../../../../../../extensions/com.aiy.natural-watermark/manifest.json';
import guideManifest from '../../../../../../extensions/com.aiy.maintenance-guide/manifest.json';
import languageManifest from '../../../../../../extensions/com.aiy.language.zh-cn/manifest.json';

// Prepared catalog data; these real list components never query or change the user's extensions.
const extensions: ExtensionDto[] = [guideManifest, watermarkManifest, demoManifest, languageManifest].map(
  (manifest) => ({
    manifest: manifest as ExtensionDto['manifest'],
    source: 'BUILT_IN',
    enabled: true,
    compatible: true,
    effective: true,
    connectionState: 'READY',
    connectionMessage: '',
    permissions: [],
    installedAt: '',
    updatedAt: '',
  }),
);

export function DemoExitWindow({
  time,
  previewWidth,
  onPreview,
}: {
  time: number;
  previewWidth: number;
  onPreview(preview: DemoExitPreview): void;
}) {
  const { messages } = useI18n();
  const copy = messages.extensions;
  const windowRoot = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const pausedTime = demoCues.motionHold + demoOutroCues.returnWindow;
  const chapter = demoChapterAt(pausedTime);
  const visible = time >= demoOutroCues.returnWindow && time < demoOutroCues.closed;

  // Measure the actual flow layout before the return shot starts, including translated labels.
  useLayoutEffect(() => {
    const root = windowRoot.current;
    const target = preview.current;
    if (!root || !target) return;
    const measure = () => {
      const frame = root.getBoundingClientRect();
      const bounds = target.getBoundingClientRect();
      if (!frame.width || !bounds.width) return;
      const scale = root.offsetWidth / frame.width;
      onPreview({
        x: (bounds.left - frame.left) * scale,
        y: (bounds.top - frame.top) * scale,
        width: bounds.width * scale,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(target);
    if (target.parentElement) observer.observe(target.parentElement);
    return () => observer.disconnect();
  }, [onPreview, messages]);

  return (
    <div
      ref={windowRoot}
      inert
      aria-hidden={!visible}
      className="pointer-events-none absolute inset-x-0 top-0 bottom-14 z-0 isolate flex flex-col overflow-hidden bg-background text-foreground"
      style={{ visibility: visible ? 'visible' : 'hidden' }}
    >
      <header className="flex h-10 shrink-0 items-center gap-3 border-b bg-muted px-3 text-xs">
        <AiyIdentity avatar className="size-4" />
        <span>{messages.app.title}</span>
        <ChevronDown className="size-3" />
        <ChevronLeft className="ml-5 size-4" />
        <ChevronRight className="size-4" />
        <CircleCheck className="ml-auto size-4 text-success" />
        <span>{messages.appShell.tasksIdle}</span>
        <Minus className="ml-8 size-4" />
        <Square className="mx-5 size-3" />
        <X className="size-4" />
      </header>
      <Tabs value="extensions" className="h-10 shrink-0 border-b bg-muted/50 pl-[88px]">
        <TabsList className="h-full">
          <TabsTrigger value="extensions">{messages.app.navigation.packs}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="flex min-h-0 flex-1">
        <AppSidebar
          spaceName="AIY"
          spaceCoverUrl={null}
          spaceTransitioning={false}
          libraryBusy={false}
          codexImagesVisible
          transitionShowcaseVisible={false}
          view="packs"
          onViewChange={demoNoop}
          onSettingsOpen={demoNoop}
          notify={demoNoop}
        />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-6 border-b px-5">
            <strong>{copy.title}</strong>
            <Tabs value="plugins">
              <TabsList>
                <TabsTrigger value="plugins">{copy.tabs.plugins}</TabsTrigger>
                <TabsTrigger value="contentPacks">{copy.tabs.contentPacks}</TabsTrigger>
              </TabsList>
            </Tabs>
          </header>
          <div className="flex min-h-0 flex-1">
            <aside className="w-[360px] shrink-0 overflow-y-auto border-r">
              <div className="border-b p-3">
                <Button variant="outline" className="w-full">
                  <PackagePlus />
                  {copy.actions.installLocal}
                </Button>
              </div>
              <ExtensionPluginList extensions={extensions} selectedId={demoManifest.id} onSelect={demoNoop} />
            </aside>
            <div className="@container/extension-detail min-h-0 min-w-0 flex-1">
              <article className="mx-auto flex h-full w-full max-w-6xl flex-col gap-5 p-6">
                <ExtensionPluginHeader
                  extension={extensions[2]}
                  actions={
                    <>
                      <Button variant="ghost" size="icon" aria-label={copy.actions.refresh}>
                        <RefreshCw className="size-4" />
                      </Button>
                      <Button variant="outline">
                        <Power className="size-4" />
                        {copy.actions.disable}
                      </Button>
                    </>
                  }
                />
                <Tabs value="feature" className="shrink-0">
                  <TabsList>
                    <TabsTrigger value="feature">{copy.pluginTabs.feature}</TabsTrigger>
                    <TabsTrigger value="settings">{copy.pluginTabs.settings}</TabsTrigger>
                  </TabsList>
                </Tabs>
                <Tabs value="v050" className="shrink-0">
                  <TabsList>
                    <TabsTrigger value="v050">{copy.featureDemo.v050.title}</TabsTrigger>
                    <TabsTrigger value="generic">{copy.featureDemo.title}</TabsTrigger>
                  </TabsList>
                </Tabs>
                <section className="flex min-h-0 flex-1 flex-col gap-3">
                  <div className="max-w-full shrink-0" style={{ width: previewWidth }}>
                    <DemoPlaybackControls
                      ready
                      playing={false}
                      time={pausedTime}
                      onToggle={demoNoop}
                      onReplay={demoNoop}
                      onSeek={demoNoop}
                      onFullscreen={demoNoop}
                    />
                  </div>
                  <div className="relative min-h-0 flex-1 [container-type:size]">
                    <div
                      ref={preview}
                      data-demo-exit-preview
                      className="absolute left-0 top-0 aspect-video w-[min(100cqw,calc(100cqh*16/9))] bg-selected"
                    />
                  </div>
                  <div className="max-w-full shrink-0" style={{ width: previewWidth }}>
                    <Slider
                      value={[pausedTime]}
                      min={0}
                      max={DEMO_DURATION}
                      step={1 / DEMO_FPS}
                      aria-label={copy.featureDemo.timelineAria}
                      onValueChange={demoNoop}
                      className="shrink-0"
                    />
                  </div>
                  <nav className="flex shrink-0 flex-wrap gap-1" aria-label={copy.featureDemo.v050.chapters}>
                    {demoChapters.map((item) => (
                      <Button
                        key={item.id}
                        size="sm"
                        variant={item.id === chapter.id ? 'secondary' : 'ghost'}
                        onClick={demoNoop}
                      >
                        {copy.featureDemo.v050.scenes[item.id]}
                      </Button>
                    ))}
                  </nav>
                </section>
              </article>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export function DemoExitTray({ time, onTargets }: { time: number; onTargets(targets: DemoExitTargets): void }) {
  const { messages } = useI18n();
  const menu = useRef<HTMLDivElement>(null);
  const { tray, menu: bounds } = demoExitLayout;
  const menuOpen = time >= demoOutroCues.trayOpen && time < demoOutroCues.quitClick;
  useLayoutEffect(() => {
    if (!menuOpen) return;
    const root = menu.current?.getBoundingClientRect();
    const quit = menu.current?.querySelector('[data-demo-tray-quit]')?.getBoundingClientRect();
    if (!root?.width || !quit?.width) return;
    const scale = (bounds.width * bounds.scale) / root.width;
    onTargets({
      quit: [
        bounds.x + (quit.left + quit.width * 0.65 - root.left) * scale,
        bounds.y + (quit.top + quit.height / 2 - root.top) * scale,
      ],
    });
  }, [menuOpen, onTargets, bounds]);
  if (time < demoOutroCues.returnWindow) return null;
  return (
    <div inert className="pointer-events-none contents">
      <div className="absolute inset-x-0 bottom-0 z-0 h-14 border-t bg-muted" />
      {time < demoOutroCues.closed && (
        <>
          <div
            className="absolute z-0 flex size-10 items-center justify-center"
            style={{ left: tray[0] - 20, top: tray[1] - 20 }}
          >
            <img src={demoOutroMedia.tray} alt={messages.app.title} className="size-6" />
          </div>
          <div
            ref={menu}
            className={cn(petalMenuSurfaceClass, 'absolute z-20 rounded-md border p-1')}
            style={{
              ...appearanceStyle('rose'),
              left: bounds.x,
              top: bounds.y,
              width: bounds.width,
              transform: `scale(${bounds.scale})`,
              transformOrigin: 'top left',
              visibility: menuOpen ? 'visible' : 'hidden',
            }}
            role="menu"
            aria-label={messages.app.title}
          >
            <TrayMenuItems
              preview
              previewQuitFocused={time >= demoOutroCues.quitHover}
              state={{ taskCount: 0, windowReady: true, quittingSoon: false }}
              onAction={demoNoop}
            />
          </div>
        </>
      )}
    </div>
  );
}

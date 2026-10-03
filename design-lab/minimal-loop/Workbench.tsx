import type { Transaction } from '@tiptap/pm/state';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LanguagesIcon, PanelLeftIcon, PanelRightIcon, ListTreeIcon, XIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/renderer/components/ui/dialog';
import { ContentDocumentOutline } from '@/renderer/features/content-editor/ContentDocumentOutline';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useLayout } from './useLayout';
import { useWorkbench } from './useWorkbench';
import { WorkEditor } from './WorkEditor';
import { InputsPanel, OutputsPanel, TopicsPanel } from './Panels';
import { workTitle } from './workTitle';
import type { Panel } from './types';

function PanelShell({ title, close, children }: { title: string; close(): void; children: ReactNode }) {
  const copy = useI18n().messages.referenceOutline;
  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>
        <Button size="icon-sm" variant="ghost" aria-label={copy.collapse} onClick={close}>
          <XIcon className="size-4" />
        </Button>
      </div>
      {children}
    </>
  );
}

export function Workbench() {
  const { locale, setLocale, messages } = useI18n();
  const copy = messages.designLab.themeCreation;
  const outline = messages.referenceOutline;
  const model = useWorkbench();
  const layout = useLayout();
  const [contents, setContents] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const triggers = useRef<Partial<Record<Panel, HTMLButtonElement | null>>>({});
  const lastTrigger = useRef<Panel>('topics');
  const returningToEditor = useRef(false);
  const { drawer, setDrawer } = layout;
  useEffect(() => {
    const editor = model.session?.editor;
    if (!editor || drawer !== 'inputs' || !contents) return;
    const navigate = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.getMeta('aiy:block-navigation')) return;
      returningToEditor.current = true;
      setDrawer(null);
    };
    editor.on('transaction', navigate);
    return () => {
      editor.off('transaction', navigate);
    };
  }, [model.session, drawer, contents, setDrawer]);
  const closeDrawer = () => layout.setDrawer(null);
  const navigateFromDrawer = () => {
    returningToEditor.current = drawer !== null;
    closeDrawer();
  };
  const labels = { topics: copy.topics, inputs: copy.input, outputs: copy.outputs };
  const icons = { topics: PanelLeftIcon, inputs: ListTreeIcon, outputs: PanelRightIcon };
  function panelContent(panel: Panel) {
    if (panel === 'topics') return <TopicsPanel model={model} onNavigate={navigateFromDrawer} />;
    if (panel === 'outputs') return <OutputsPanel model={model} onNavigate={navigateFromDrawer} />;
    return (
      <>
        <div className="flex shrink-0 gap-1 border-b p-2">
          <Button variant="ghost" size="sm" aria-pressed={!contents} onClick={() => setContents(false)}>
            {copy.input}
          </Button>
          <Button variant="ghost" size="sm" aria-pressed={contents} onClick={() => setContents(true)}>
            {outline.contents}
          </Button>
        </div>
        {contents && model.session ? (
          <ContentDocumentOutline key={model.work.id} editor={model.session.editor} />
        ) : (
          <InputsPanel model={model} />
        )}
      </>
    );
  }
  const auxiliary = (panel: Panel, side: string) => (
    <aside
      key={panel}
      data-minimal-panel={panel}
      hidden={!layout.visible(panel)}
      className={layout.visible(panel) ? `flex w-60 shrink-0 flex-col bg-background ${side}` : 'hidden'}
      aria-label={labels[panel]}
    >
      <PanelShell
        title={labels[panel]}
        close={() => {
          layout.toggle(panel);
          triggers.current[panel]?.focus();
        }}
      >
        {panelContent(panel)}
      </PanelShell>
    </aside>
  );
  return (
    <main
      ref={layout.container}
      className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background font-sans text-foreground"
    >
      <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-1 border-b px-3 py-1">
        <a href="./index.html" className="mr-2 text-sm font-semibold underline-offset-4 hover:underline">
          AIY
        </a>
        {(['topics', 'inputs', 'outputs'] as const).map((panel) => {
          const Icon = icons[panel];
          return (
            <Button
              key={panel}
              data-minimal-trigger={panel}
              ref={(node) => {
                triggers.current[panel] = node;
              }}
              size="icon-sm"
              variant="ghost"
              title={labels[panel]}
              aria-label={labels[panel]}
              aria-expanded={layout.visible(panel) || layout.drawer === panel}
              onClick={() => {
                lastTrigger.current = panel;
                layout.toggle(panel);
              }}
            >
              <Icon className="size-4" />
            </Button>
          );
        })}
        <span className="min-w-0 flex-1 truncate px-2 text-sm">{model.topic.title}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={messages.designLab.language}
          onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
        >
          <LanguagesIcon className="size-4" />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1">
        {auxiliary('topics', 'border-r')}
        {auxiliary('inputs', 'border-r')}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
          <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b px-4 py-1">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{workTitle(model.work, copy)}</span>
            {model.work.source && (
              <Button size="xs" variant="ghost" onClick={() => model.select(model.work.source!.workId)}>
                {copy.returnOriginal}
              </Button>
            )}
            <Button size="xs" variant="ghost" disabled={!model.session} onClick={() => model.exportWork('md')}>
              {outline.export}
            </Button>
            <Button size="xs" variant="ghost" disabled={!model.session} onClick={() => model.exportWork('json')}>
              {outline.exportJson}
            </Button>
          </div>
          {model.error && (
            <div role="alert" className="px-4 py-2 text-sm text-destructive">
              {outline[model.error]}
            </div>
          )}
          {model.works
            .filter((work) => model.visited.has(work.id))
            .map((work) => (
              <WorkEditor
                key={work.id}
                work={work}
                active={work.id === model.work.id}
                register={model.register}
                onError={model.setError}
              />
            ))}
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-2">
            <Button size="sm" variant="ghost" disabled={!model.session} onClick={() => model.derive()}>
              {copy.saveSeparate}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              disabled={!model.session || Boolean(model.work.channel)}
              onClick={() => setPublishing(true)}
            >
              {copy.publication}
            </Button>
          </div>
        </div>
        {auxiliary('outputs', 'border-l')}
      </div>
      <Dialog
        open={layout.drawer !== null}
        onOpenChange={(open) => {
          if (!open) closeDrawer();
        }}
      >
        <DialogContent
          className="flex h-[80dvh] max-w-sm flex-col gap-0 p-0"
          aria-describedby={undefined}
          showCloseButton={false}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returningToEditor.current && model.session && !model.session.editor.isDestroyed)
              model.session.editor.view.focus();
            else triggers.current[lastTrigger.current]?.focus();
            returningToEditor.current = false;
          }}
        >
          <DialogTitle className="sr-only">{layout.drawer ? labels[layout.drawer] : copy.topics}</DialogTitle>
          {layout.drawer && (
            <PanelShell title={labels[layout.drawer]} close={closeDrawer}>
              {panelContent(layout.drawer)}
            </PanelShell>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={publishing} onOpenChange={setPublishing}>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>{copy.publication}</DialogTitle>
          <div className="flex flex-wrap gap-2">
            {(['wechat', 'rednote'] as const).map((channel) => (
              <Button
                key={channel}
                variant="outline"
                onClick={() => {
                  if (model.derive(channel)) setPublishing(false);
                }}
              >
                {copy[channel]}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}

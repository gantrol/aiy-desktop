import { useState, type ReactNode } from 'react';
import { ArrowLeftIcon, ChevronDownIcon, HistoryIcon, LoaderCircleIcon, PanelRightIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Textarea } from '@/renderer/components/ui/textarea';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/renderer/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogTitle } from '@/renderer/components/ui/dialog';
import { cn } from '@/renderer/lib/utils';
import { Cover, IconButton, Menu, kindIcons } from './theme-creation-ui';
import { HistoryDialog, PublishDialog, SourceDialog } from './theme-creation-dialogs';
import { OutputNavigation } from './theme-creation-navigation';
import { ReturnToWork } from './theme-creation-relations';
import type { ThemeModel } from './theme-creation-model';

function Candidate({ model, navigationToggle }: { model: ThemeModel; navigationToggle: ReactNode }) {
  const { copy, task, topic } = model;
  if (!task) return null;
  const target = topic.outputs.find((item) => item.id === task.preparation.targetId);
  const stale = Boolean(task.preparation.targetId && (!target || target.revision !== task.preparation.baseRevision));
  const ready = task.status === 'ready';
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-3">
        <Button variant="ghost" size="sm" onClick={() => model.viewTask(null)}>
          <ArrowLeftIcon className="size-4" />
          {copy.outputs}
        </Button>
        <span className="text-sm font-semibold">{copy.candidate}</span>
        <span className="ml-auto text-xs text-muted-foreground">{copy[task.status]}</span>
        {navigationToggle}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-6 lg:px-10">
        <div className="mx-auto max-w-3xl">
          <div className="mb-6 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{copy.resultTarget}:</span>
            <span>{target?.title ?? `${copy.newResult} · ${copy[task.kind]}`}</span>
            <span className="ml-auto">
              {copy.input} {task.preparation.inputs.length}
            </span>
          </div>
          {task.status === 'running' ? (
            <div role="status" className="flex min-h-56 items-center justify-center gap-3 text-muted-foreground">
              <LoaderCircleIcon className="size-5 animate-spin" />
              {copy.waiting}
            </div>
          ) : task.status === 'cancelled' ? (
            <div className="py-10 text-muted-foreground">{copy.cancelled}</div>
          ) : (
            <>
              {stale && ready && (
                <div role="status" className="mb-5 border-l-2 border-warning py-2 pl-3 text-sm text-warning">
                  {copy.targetChanged}
                </div>
              )}
              {task.kind === 'image' ? (
                <div className="grid gap-5 sm:grid-cols-2">
                  {[0, 1].map((variant) => (
                    <Button
                      key={variant}
                      variant="ghost"
                      aria-pressed={task.image === variant}
                      disabled={!ready}
                      className={cn(
                        'h-auto flex-col whitespace-normal rounded-sm border p-2',
                        task.image === variant ? 'border-foreground' : 'border-transparent',
                      )}
                      onClick={() => model.patchTask({ image: variant })}
                    >
                      <Cover copy={copy} title={task.preparation.inputs[0]?.title ?? topic.title} variant={variant} />
                      <span className="py-1 text-xs">{variant === 0 ? copy.coverA : copy.coverB}</span>
                    </Button>
                  ))}
                </div>
              ) : (
                <>
                  <Input
                    aria-label={copy.outputTitle}
                    value={task.title}
                    disabled={!ready}
                    onChange={(event) => model.patchTask({ title: event.target.value })}
                    className="mb-5 h-12 border-0 bg-transparent px-0 text-xl font-semibold shadow-none"
                  />
                  <Textarea
                    aria-label={copy.body}
                    value={task.body}
                    readOnly={!ready}
                    onChange={(event) => model.patchTask({ body: event.target.value })}
                    className="min-h-80 resize-y border-0 bg-transparent px-0 text-base leading-8 shadow-none"
                  />
                </>
              )}
            </>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t px-4 py-3">
        {task.status === 'running' && (
          <Button variant="outline" onClick={() => model.cancelTask(task.id)}>
            {copy.cancelRun}
          </Button>
        )}
        {ready && (
          <>
            {task.preparation.targetId && (
              <Button variant="outline" onClick={() => model.adopt(true)}>
                {copy.saveSeparate}
              </Button>
            )}
            <Button disabled={stale} onClick={() => model.adopt(false)}>
              {task.preparation.targetId ? copy.applyDraft : copy.keepOutput}
            </Button>
          </>
        )}
      </div>
    </>
  );
}
function Editor({
  model,
  showInputs,
  navigationToggle,
}: {
  model: ThemeModel;
  showInputs(): void;
  navigationToggle: ReactNode;
}) {
  const { copy, output } = model;
  const [dialog, setDialog] = useState<'sources' | 'publish' | 'history' | null>(null);
  const Icon = kindIcons[output.kind];
  const prepare = (method: 'article' | 'outline' | 'image' | 'rewrite') => {
    model.prepareFromOutput(method);
    showInputs();
  };
  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-2 px-4">
        <Icon className="size-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{copy[output.kind]}</span>
        <ReturnToWork model={model} />
        <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">{copy.memorySaved}</span>
        <Menu label={copy.more}>
          <DropdownMenuItem onSelect={() => setDialog('sources')}>
            {copy.sources} · {output.sources.length}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={model.saveVersion}>{copy.revision}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog('history')}>
            <HistoryIcon className="size-3.5" />
            {copy.history} · {output.versions.length}
          </DropdownMenuItem>
        </Menu>
        {navigationToggle}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-5 sm:px-9 lg:px-12">
        <div className="mx-auto max-w-3xl">
          <Input
            aria-label={copy.outputTitle}
            value={output.title}
            onChange={(event) => model.editOutput({ title: event.target.value })}
            className="mb-6 h-14 border-0 bg-transparent px-0 text-2xl font-semibold shadow-none"
          />
          {output.kind === 'image' ? (
            output.body ? (
              <Cover copy={copy} title={output.body} variant={output.image} />
            ) : (
              <div className="flex min-h-64 items-center justify-center gap-3 text-muted-foreground">
                <Icon className="size-6" />
                {copy.imageEmpty}
              </div>
            )
          ) : (
            <Textarea
              aria-label={copy.body}
              autoFocus={!output.body}
              placeholder={copy.bodyPlaceholder}
              value={output.body}
              onChange={(event) => model.editOutput({ body: event.target.value })}
              className={cn(
                'min-h-[52dvh] w-full resize-none border-0 bg-transparent px-0 text-base leading-8 shadow-none',
                output.kind === 'outline' && 'font-mono text-sm',
              )}
            />
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-3">
        <Menu label={copy.continueFrom} icon={<ChevronDownIcon className="size-3.5" />}>
          <DropdownMenuItem disabled={!output.body.trim()} onSelect={() => prepare('article')}>
            {copy.expand}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!output.body.trim()} onSelect={() => prepare('outline')}>
            {copy.summarize}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!output.body.trim()} onSelect={() => prepare('image')}>
            {copy.illustrate}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!output.body.trim()}
            onSelect={() => {
              model.addInputs([model.currentSource]);
              showInputs();
            }}
          >
            {copy.useAsInput}
          </DropdownMenuItem>
        </Menu>
        {output.kind !== 'image' && (
          <Button variant="ghost" size="sm" disabled={!output.body.trim()} onClick={() => prepare('rewrite')}>
            {copy.rewrite}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={!output.body.trim()}
          onClick={() => {
            model.editPlatform('wechat', {});
            setDialog('publish');
          }}
        >
          {copy.publish}
        </Button>
      </div>
      {dialog === 'sources' && <SourceDialog sources={output.sources} model={model} close={() => setDialog(null)} />}
      {dialog === 'publish' && <PublishDialog model={model} close={() => setDialog(null)} />}
      {dialog === 'history' && <HistoryDialog model={model} close={() => setDialog(null)} />}
    </>
  );
}
export function OutputWorkspace({ model, showInputs }: { model: ThemeModel; showInputs(): void }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const toggle = (
    <>
      <span className="md:hidden">
        <IconButton label={model.copy.expandOutputs} onClick={() => setDrawerOpen(true)}>
          <PanelRightIcon className="size-4" />
        </IconButton>
      </span>
      {!sidebarOpen && (
        <span className="hidden md:inline-flex">
          <IconButton label={model.copy.expandOutputs} onClick={() => setSidebarOpen(true)}>
            <PanelRightIcon className="size-4" />
          </IconButton>
        </span>
      )}
    </>
  );
  return (
    <section className="flex min-h-0 min-w-0 flex-1 bg-surface" aria-label={model.copy.outputs}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {model.task ? (
          <Candidate model={model} navigationToggle={toggle} />
        ) : (
          <Editor key={model.output.id} model={model} showInputs={showInputs} navigationToggle={toggle} />
        )}
      </div>
      {sidebarOpen && (
        <aside className="hidden w-60 shrink-0 flex-col border-l md:flex" aria-label={model.copy.rightSidebar}>
          <OutputNavigation model={model} close={() => setSidebarOpen(false)} showInputs={showInputs} />
        </aside>
      )}
      <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogContent
          className="fixed top-0 right-0 bottom-0 left-auto flex h-dvh max-h-none w-72 max-w-[90vw] flex-col translate-x-0 translate-y-0 gap-0 rounded-none p-0"
          showCloseButton={false}
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">{model.copy.rightSidebar}</DialogTitle>
          <div className="flex min-h-0 flex-1 flex-col">
            <OutputNavigation
              model={model}
              close={() => setDrawerOpen(false)}
              onNavigate={() => setDrawerOpen(false)}
              showInputs={() => {
                setDrawerOpen(false);
                showInputs();
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

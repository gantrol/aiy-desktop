import { ArrowLeft, X, FolderOpen } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { cn } from '@/renderer/lib/utils';
import type { ReadingWorkspace, ReadingLayout } from '@/renderer/features/creation-reading/useCreationReadingWorkspace';
import { ReadingSourceView } from '@/renderer/features/creation-reading/ReadingSourceView';
import { ReadingEntries } from '@/renderer/features/creation-reading/ReadingEntries';

export function ReadingInputPane({ workspace }: { workspace: ReadingWorkspace }) {
  const { copy, reading, source, input, showInput, split, ratio, selection, busy } = workspace;
  return (
    <section
      aria-label={copy.references}
      className={cn('flex min-h-0 min-w-0 flex-col overflow-hidden', !showInput && 'hidden')}
      style={split ? { flex: '0 0 ' + ratio + '%' } : { flex: '1 1 0' }}
      inert={!showInput}
    >
      <header className="flex min-h-14 shrink-0 items-center gap-1 border-b px-2">
        {workspace.returnPoint && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={workspace.returnPoint.focus ? copy.backToDocument : copy.backToReading}
            title={workspace.returnPoint.focus ? copy.backToDocument : copy.backToReading}
            onClick={workspace.returnFromSource}
          >
            <ArrowLeft className="size-4" />
          </Button>
        )}
        {reading.sources.length ? (
          <Select value={source?.id ?? ''} onOpenChange={workspace.setMenuOpen} onValueChange={workspace.choose}>
            <SelectTrigger className="h-8 min-w-0 flex-1" aria-label={copy.source}>
              <SelectValue placeholder={copy.source} />
            </SelectTrigger>
            <SelectContent>
              {reading.sources.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="mr-auto text-sm font-medium">{copy.references}</span>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={busy}
          title={copy.openFile}
          aria-label={copy.openFile}
          onClick={() => input.current?.click()}
        >
          <FolderOpen className="size-4" />
        </Button>
        <Select
          value={workspace.layout}
          onOpenChange={workspace.setMenuOpen}
          onValueChange={(value) => workspace.setLayout(value as ReadingLayout)}
        >
          <SelectTrigger className="h-8 w-20 shrink-0" aria-label={copy.layout}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="SINGLE">{copy.single}</SelectItem>
            <SelectItem value="HORIZONTAL">{copy.horizontal}</SelectItem>
            <SelectItem value="VERTICAL">{copy.vertical}</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="icon-sm"
          variant="ghost"
          title={copy.closeReferences}
          aria-label={copy.closeReferences}
          onClick={workspace.closeReferences}
        >
          <X className="size-4" />
        </Button>
      </header>
      <Input
        type="file"
        ref={input}
        accept=".pdf,.epub,.html,.htm,.txt,.md"
        className="hidden"
        aria-label={copy.openFile}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) workspace.importFile(file);
        }}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {source && workspace.started && showInput ? (
          <ReadingSourceView
            key={source.id}
            source={source}
            articleId={workspace.articleId}
            spaceId={workspace.spaceId}
            visible={
              showInput && !workspace.menuOpen && workspace.dimensions.width > 0 && workspace.dimensions.height > 0
            }
            previewRequest={workspace.previewRequest}
            reveal={workspace.revealLocation}
            onSelect={workspace.setSelection}
            position={reading.positions?.find((item) => item.sourceId === source.id)}
            onPosition={workspace.rememberPosition}
            onRevealFailed={workspace.onRevealFailed}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-4">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
              {copy.openFile}
            </Button>
          </div>
        )}
      </div>
      {selection?.text.trim() && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-t px-2 py-1">
          <Button
            size="sm"
            variant="secondary"
            onMouseDown={(event) => event.preventDefault()}
            onClick={workspace.quoteSelection}
          >
            {copy.quoteToEnd}
          </Button>
          <Button size="sm" variant="ghost" onMouseDown={(event) => event.preventDefault()} onClick={workspace.addNote}>
            {copy.note}
          </Button>
        </div>
      )}
      {workspace.notesOpen && (
        <div className="flex min-h-28 max-h-[55%] basis-[38%] flex-col border-t">
          <ReadingEntries
            reading={reading}
            onUpdate={workspace.editEntry}
            onDelete={(id) =>
              workspace.update((current) => ({
                ...current,
                entries: current.entries.filter((entry) => entry.id !== id),
              }))
            }
            onSource={(id, location, quote) => workspace.openSource(id, location, quote)}
            onAdd={workspace.addNote}
          />
        </div>
      )}
      <footer className="flex min-h-10 shrink-0 items-center gap-1 border-t px-2">
        <Button
          size="sm"
          variant={workspace.notesOpen ? 'secondary' : 'ghost'}
          aria-pressed={workspace.notesOpen}
          onClick={() => workspace.setNotesOpen((value) => !value)}
        >
          {copy.notes} {reading.entries.length || ''}
        </Button>
        {busy && (
          <span role="status" className="ml-auto text-xs text-muted-foreground">
            {copy.loading}
          </span>
        )}
      </footer>
    </section>
  );
}

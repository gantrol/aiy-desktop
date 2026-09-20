import { useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/renderer/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { OutlineExampleDocument } from '@/renderer/features/content-editor/OutlineExampleDocument';
import { useI18n } from '@/renderer/i18n/useI18n';
import { aiyOutlineExample } from '@/shared/examples/aiy-outline';
import { softwareDevelopmentOutlineExample } from '@/shared/examples/software-development-outline';

const examples = [
  { id: 'creation', createDocument: aiyOutlineExample, fileStem: 'AIY-outline-example' },
  { id: 'software', createDocument: softwareDevelopmentOutlineExample, fileStem: 'AIY-software-development-example' },
] as const;

/** Lazy, isolated examples: switching tabs keeps each editor's input and undo history. */
export function AIYOutlineExample() {
  const copy = useI18n().messages.referenceOutline;
  const [selection, setSelection] = useState({ active: 'creation', visited: new Set(['creation']) });
  const title = (id: string) => (id === 'creation' ? copy.example : copy.softwareExample);
  return (
    <Tabs
      className="min-h-0 flex-1 gap-2"
      value={selection.active}
      activationMode="manual"
      onValueChange={(value) => {
        if (!examples.some((example) => example.id === value)) return;
        setSelection((previous) => ({ active: value, visited: new Set([...previous.visited, value]) }));
      }}
    >
      <TabsList aria-label={copy.example} className="h-auto shrink-0 flex-wrap">
        {examples.map((example) => (
          <TabsTrigger key={example.id} value={example.id} className="h-auto max-w-full whitespace-normal py-2">
            {title(example.id)}
          </TabsTrigger>
        ))}
      </TabsList>
      <p className="shrink-0 text-xs text-muted-foreground">{copy.exampleNote}</p>
      {examples.map((example) =>
        selection.visited.has(example.id) ? (
          <TabsContent
            key={example.id}
            value={example.id}
            forceMount
            hidden={selection.active !== example.id}
            className={selection.active === example.id ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
          >
            <OutlineExampleDocument {...example} title={title(example.id)} />
          </TabsContent>
        ) : null,
      )}
    </Tabs>
  );
}

export function AIYOutlineExampleDialog() {
  const copy = useI18n().messages.referenceOutline;
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          {copy.example}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[80vh] max-w-5xl flex-col" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{copy.example}</DialogTitle>
        </DialogHeader>
        {open && <AIYOutlineExample />}
      </DialogContent>
    </Dialog>
  );
}

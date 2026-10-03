import { useState } from 'react';
import { CheckIcon, FileTextIcon, FolderIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { topics } from './data';
import { workTitle } from './workTitle';
import type { WorkbenchModel } from './useWorkbench';

interface Props {
  model: WorkbenchModel;
  onNavigate(): void;
}
const row = 'h-auto min-h-9 w-full justify-start whitespace-normal rounded-sm px-3 py-2 text-left font-normal';

export function TopicsPanel({ model, onNavigate }: Props) {
  const copy = useI18n().messages.designLab.themeCreation;
  const [query, setQuery] = useState('');
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-2">
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={copy.searchTopics}
        aria-label={copy.searchTopics}
      />
      <nav aria-label={copy.topics} className="min-h-0 overflow-auto">
        {topics
          .filter((topic) => topic.title.toLowerCase().includes(query.toLowerCase()))
          .map((topic) => (
            <Button
              key={topic.id}
              variant="ghost"
              className={cn(row, topic.id === model.topic.id && 'bg-selected text-selected-foreground')}
              aria-current={topic.id === model.topic.id ? 'page' : undefined}
              onClick={() => {
                if (model.selectTopic(topic.id)) onNavigate();
              }}
            >
              <FolderIcon className="size-4" />
              <span className="min-w-0 flex-1">{topic.title}</span>
            </Button>
          ))}
      </nav>
    </div>
  );
}
export function InputsPanel({ model }: { model: WorkbenchModel }) {
  const copy = useI18n().messages.designLab.themeCreation;
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
        {copy.selected}
        <span className="tabular-nums">{model.work.inputs.length}</span>
      </div>
      <div className="space-y-5">
        {model.topic.materials.map((material) => {
          const selected = model.work.inputs.some((item) => item.id === material.id);
          return (
            <section key={material.id}>
              <Button
                variant="ghost"
                className={cn(row, selected && 'bg-selected text-selected-foreground')}
                aria-pressed={selected}
                onClick={() => model.toggleInput(material)}
              >
                <span className="min-w-0 flex-1">{material.title}</span>
                {selected && <CheckIcon className="size-4" />}
              </Button>
              <p className="mt-2 px-3 text-sm leading-6 text-foreground-secondary">{material.body}</p>
            </section>
          );
        })}
      </div>
    </div>
  );
}
export function OutputsPanel({ model, onNavigate }: Props) {
  const copy = useI18n().messages.designLab.themeCreation;
  const works = model.works.filter((work) => work.topicId === model.topic.id);
  const ordered = works
    .filter((work) => !work.channel)
    .flatMap((work) => [
      work,
      ...works.filter((candidate) => candidate.channel && candidate.source?.workId === work.id),
    ]);
  return (
    <nav aria-label={copy.outputs} className="min-h-0 flex-1 overflow-auto p-2">
      {ordered.map((work) => (
        <Button
          key={work.id}
          variant="ghost"
          className={cn(
            row,
            work.channel && 'pl-7',
            work.id === model.work.id && 'bg-selected text-selected-foreground',
          )}
          aria-current={work.id === model.work.id ? 'page' : undefined}
          onClick={() => {
            if (model.select(work.id)) onNavigate();
          }}
        >
          <FileTextIcon className="size-4" />
          <span className="min-w-0 flex-1">{work.channel ? copy[work.channel] : workTitle(work, copy)}</span>
        </Button>
      ))}
    </nav>
  );
}

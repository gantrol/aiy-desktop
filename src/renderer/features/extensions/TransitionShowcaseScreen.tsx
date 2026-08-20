import type { FacetDefinitionDto, TermListItem } from '@/shared/contracts';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { TransitionShowcase } from '@/renderer/features/extensions/TransitionShowcase';

export function TransitionShowcaseScreen({
  active,
  libraryKey,
  dataRevision,
  terms,
  facets,
  notify,
}: {
  active: boolean;
  libraryKey: string;
  dataRevision: number;
  terms: readonly TermListItem[];
  facets: readonly FacetDefinitionDto[];
  notify(message: string): void;
}) {
  return (
    <ScrollArea className="size-full bg-background">
      <div className="mx-auto w-full max-w-6xl p-6">
        <TransitionShowcase
          active={active}
          libraryKey={libraryKey}
          dataRevision={dataRevision}
          terms={terms}
          facets={facets}
          notify={notify}
        />
      </div>
    </ScrollArea>
  );
}

export default TransitionShowcaseScreen;

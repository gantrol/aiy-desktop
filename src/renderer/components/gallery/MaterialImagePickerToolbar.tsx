import { useRef, useState } from 'react';
import { SearchIcon, XIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { MaterialAlbumDto } from '@/shared/contracts';
import type { DictionaryMaterialTree } from '@/renderer/components/gallery/dictionaryMaterialTree';
import type { MaterialImagePickerCollection } from '@/renderer/components/gallery/materialImagePicker';

export function materialImagePickerScope(
  collection: MaterialImagePickerCollection,
  albums: readonly MaterialAlbumDto[],
  tree: DictionaryMaterialTree,
  labels: { allMaterials: string; dictionary: string },
) {
  if (collection.kind === 'all') return labels.allMaterials;
  if (collection.kind === 'album')
    return albums.find((album) => album.id === collection.albumId)?.title ?? labels.allMaterials;
  const domain = tree.domains.find((node) => node.domainId === collection.domainId);
  const type = domain?.types.find((node) => node.typeId === collection.typeId);
  const term = type?.terms.find((node) => node.term.id === collection.termId);
  return [labels.dictionary, domain?.title, type?.title, term?.title].filter(Boolean).join(' / ');
}

export function MaterialImagePickerToolbar({
  scope,
  onQueryChange,
}: {
  scope: string;
  onQueryChange(query: string): void;
}) {
  const { messages } = useI18n();
  const copy = messages.gallery.imagePicker;
  const [query, setQuery] = useState('');
  const composing = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="shrink-0 space-y-2 border-b px-3 py-2">
      <div className="relative">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={input}
          type="search"
          data-action="material-picker-search"
          aria-label={copy.search}
          placeholder={copy.search}
          value={query}
          className="pl-9 pr-9"
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            onQueryChange(event.currentTarget.value);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!composing.current) onQueryChange(event.target.value);
          }}
        />
        {query && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute right-1 top-1/2 size-7 -translate-y-1/2"
            aria-label={messages.gallery.library.clearSearch}
            onClick={() => {
              setQuery('');
              onQueryChange('');
              input.current?.focus();
            }}
          >
            <XIcon aria-hidden="true" className="size-3.5" />
          </Button>
        )}
      </div>
      <div className="truncate text-xs text-muted-foreground" title={scope}>
        {scope}
      </div>
    </div>
  );
}

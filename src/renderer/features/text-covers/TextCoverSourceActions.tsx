import { useRef } from 'react';
import { MoreHorizontalIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/renderer/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { Input } from '@/renderer/components/ui/input';
import { useI18n } from '@/renderer/i18n/useI18n';
import { TextCoverPreview } from '@/renderer/features/text-covers/TextCoverPreview';
import { useTextCoverSource } from '@/renderer/features/text-covers/useTextCoverSource';
import { requestTextCoverSourceDownload } from '@/renderer/features/text-covers/textCoverSource';
import type { TextCoverSource } from '@/shared/contracts/text-cover-source';
import type { TextCoverRecipe } from '@/renderer/features/text-covers/textCoverPresets';
import type { ArticleCoverRatio } from '@/shared/article-covers';

interface TextCoverSourceActionsProps {
  title: string;
  ratio: ArticleCoverRatio;
  recipe: TextCoverRecipe;
  fixedRatio: boolean;
  busy: boolean;
  onBusyChange(busy: boolean): void;
  onError(message: string): void;
  onAccept(source: TextCoverSource): void;
}

export function TextCoverSourceActions(props: TextCoverSourceActionsProps) {
  const { messages } = useI18n();
  const copy = messages.textCoverSource;
  const fileInput = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const source = useTextCoverSource({
    lockedRatio: props.fixedRatio ? props.ratio : undefined,
    onBusyChange: props.onBusyChange,
    onError: (error) => props.onError(error ? copy[error] : ''),
  });
  function download() {
    props.onError('');
    try {
      requestTextCoverSourceDownload(props.title, props.ratio, props.recipe);
    } catch {
      props.onError(copy.exportFailed);
    }
  }
  return (
    <>
      <Input
        ref={fileInput}
        type="file"
        accept=".aiy-cover.json,.json,application/json"
        className="hidden"
        tabIndex={-1}
        disabled={props.busy}
        aria-label={copy.open}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file && !props.busy) void source.open(file);
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button ref={trigger} type="button" size="icon" variant="ghost" disabled={props.busy} aria-label={copy.menu}>
            <MoreHorizontalIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => fileInput.current?.click()}>{copy.open}</DropdownMenuItem>
          <DropdownMenuItem onSelect={download}>{copy.download}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TextCoverSourceConfirmation
        source={source.candidate}
        busy={props.busy}
        onClose={source.close}
        onAccept={(candidate) => {
          if (props.busy) return;
          if (props.fixedRatio && candidate.ratio !== props.ratio) {
            props.onError(copy.ratioMismatch);
            source.close();
            return;
          }
          props.onAccept(candidate);
          source.close();
        }}
        onReturnFocus={() => trigger.current?.focus()}
      />
    </>
  );
}

function TextCoverSourceConfirmation({
  source,
  busy,
  onClose,
  onAccept,
  onReturnFocus,
}: {
  source: TextCoverSource | null;
  busy: boolean;
  onClose(): void;
  onAccept(source: TextCoverSource): void;
  onReturnFocus(): void;
}) {
  const { messages } = useI18n();
  if (!source) return null;
  const copy = messages.contentEditor.textCover;
  const previewLabel = [
    `${copy.title}: ${source.title}`,
    `${copy.ratio}: ${source.ratio}`,
    `${copy.layout}: ${copy.layouts[source.recipe.layout]}`,
    `${copy.palette}: ${copy.palettes[source.recipe.palette]}`,
    `${copy.decoration}: ${copy.decorations[source.recipe.decoration]}`,
    `${copy.font}: ${copy.fonts[source.recipe.font]}`,
    `${copy.weight}: ${source.recipe.weight}`,
  ].join(' · ');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-lg rounded-md"
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <DialogTitle>{messages.textCoverSource.preview}</DialogTitle>
        <div role="img" aria-label={previewLabel}>
          <TextCoverPreview
            title={source.title}
            seed="source"
            recipe={source.recipe}
            ratio={source.ratio}
            className="w-full"
          />
        </div>
        <span className="text-sm">{source.ratio}</span>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {messages.common.cancel}
          </Button>
          <Button type="button" disabled={busy} onClick={() => onAccept(source)}>
            {messages.textCoverSource.use}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

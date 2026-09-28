import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { LoaderCircleIcon, ShuffleIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/renderer/components/ui/dialog';
import { Label } from '@/renderer/components/ui/label';
import { Textarea } from '@/renderer/components/ui/textarea';
import { useI18n } from '@/renderer/i18n/useI18n';
import { TextCoverArtwork, TextCoverPreview } from '@/renderer/features/text-covers/TextCoverPreview';
import { TextCoverControls } from '@/renderer/features/text-covers/TextCoverControls';
import { discoverTextCoverFonts } from '@/renderer/features/text-covers/textCoverFonts';
import {
  automaticTextCover,
  textCoverPresets,
  type TextCoverRecipe,
} from '@/renderer/features/text-covers/textCoverPresets';
import { buildTextCoverScene } from '@/renderer/features/text-covers/textCoverScene';
import { textCoverPng } from '@/renderer/features/text-covers/textCoverPng';
import type { ArticleCoverRatio } from '@/shared/article-covers';

export function TextCoverDialog({
  title,
  seed,
  initialRatio = '4:3',
  fixedRatio = false,
  onApply,
  onClose,
}: {
  title: string;
  seed: string;
  initialRatio?: ArticleCoverRatio;
  fixedRatio?: boolean;
  onApply(file: File, ratio: ArticleCoverRatio): Promise<void>;
  onClose(): void;
}) {
  const { messages } = useI18n();
  const copy = messages.contentEditor.textCover;
  const titleId = useId();
  const [text, setText] = useState(title);
  const [ratio, setRatio] = useState(initialRatio);
  const [recipe, setRecipe] = useState<TextCoverRecipe>(() => automaticTextCover(seed));
  const [installedFonts, setInstalledFonts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const working = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void discoverTextCoverFonts().then((fonts) => {
      if (mounted.current) setInstalledFonts(fonts);
    });
    return () => {
      mounted.current = false;
    };
  }, []);
  const scene = useMemo(() => buildTextCoverScene(text, recipe, ratio), [text, recipe, ratio]);
  async function save() {
    if (working.current || !text.trim() || scene.overflow) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      const file = await textCoverPng(scene);
      if (!mounted.current) return;
      await onApply(file, ratio);
      if (mounted.current) onClose();
    } catch (reason) {
      if (mounted.current)
        setError(
          reason instanceof Error && reason.message === 'TEXT_COVER_OVERFLOW'
            ? copy.tooLong
            : reason instanceof Error && reason.message === 'COVER_CHANGED'
              ? messages.contentEditor.coverEditor.changed
              : messages.contentEditor.coverEditor.failed,
        );
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function changeRecipe(next: TextCoverRecipe) {
    setRecipe(next);
    setError('');
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !working.current) onClose();
      }}
    >
      <DialogContent className="max-w-4xl rounded-md" aria-describedby={undefined} showCloseButton={!busy}>
        <DialogTitle>{copy.generate}</DialogTitle>
        <fieldset disabled={busy} className="grid min-w-0 gap-4">
          <div className="grid min-w-0 gap-5 sm:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <div className="grid min-w-0 content-start gap-3">
              <TextCoverArtwork scene={scene} className="max-h-80 w-full" />
              <Label htmlFor={titleId}>{copy.title}</Label>
              <Textarea
                id={titleId}
                value={text}
                rows={3}
                maxLength={1000}
                onChange={(event) => {
                  setText(event.target.value);
                  setError('');
                }}
              />
            </div>
            <TextCoverControls
              recipe={recipe}
              ratio={ratio}
              installedFonts={installedFonts}
              onChange={changeRecipe}
              onRatioChange={fixedRatio ? undefined : setRatio}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label>{copy.templates}</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => changeRecipe(automaticTextCover(crypto.randomUUID()))}
            >
              <ShuffleIcon className="size-3.5" />
              {copy.shuffle}
            </Button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2" role="group" aria-label={copy.templates}>
            {textCoverPresets.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                variant="ghost"
                className="h-auto w-28 shrink-0 flex-col gap-1 rounded-sm p-1 aria-pressed:bg-selected aria-pressed:text-selected-foreground"
                aria-pressed={Object.keys(recipe)
                  .filter((key) => key !== 'id')
                  .every((key) => recipe[key as keyof TextCoverRecipe] === preset[key as keyof TextCoverRecipe])}
                onClick={() => changeRecipe({ ...preset })}
              >
                <TextCoverPreview title={text} seed={seed} recipe={preset} ratio={ratio} className="w-full" />
                <span className="text-xs">{copy.presets[preset.id]}</span>
              </Button>
            ))}
          </div>
        </fieldset>
        {(scene.overflow || error) && (
          <p role="alert" className="text-sm text-destructive">
            {scene.overflow ? copy.tooLong : error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {messages.common.cancel}
          </Button>
          <Button type="button" disabled={busy || !text.trim() || scene.overflow} onClick={() => void save()}>
            {busy && <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />}
            {messages.contentEditor.coverEditor.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

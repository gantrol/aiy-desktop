import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { LoaderCircleIcon, ShuffleIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/renderer/components/ui/dialog';
import { Label } from '@/renderer/components/ui/label';
import { Textarea } from '@/renderer/components/ui/textarea';
import { useI18n } from '@/renderer/i18n/useI18n';
import { TextCoverArtwork } from '@/renderer/features/text-covers/TextCoverPreview';
import { TextCoverControls } from '@/renderer/features/text-covers/TextCoverControls';
import { TextCoverSourceActions } from '@/renderer/features/text-covers/TextCoverSourceActions';
import { discoverTextCoverFonts, localTextCoverFonts } from '@/renderer/features/text-covers/textCoverFonts';
import { automaticTextCover, type TextCoverRecipe } from '@/renderer/features/text-covers/textCoverPresets';
import { TextCoverPresetPicker } from '@/renderer/features/text-covers/TextCoverPresetPicker';
import { useTextCoverDrafts } from '@/renderer/features/text-covers/useTextCoverDrafts';
import { captureTextCoverSource } from '@/renderer/features/text-covers/textCoverSource';
import { useWorkspacePaneContainer } from '@/renderer/components/workspace/WorkspacePaneScope';
import type { TextCoverSource } from '@/shared/contracts/text-cover-source';
import { buildTextCoverScene } from '@/renderer/features/text-covers/textCoverScene';
import { textCoverPng } from '@/renderer/features/text-covers/textCoverPng';
import type { ArticleCoverRatio } from '@/shared/article-covers';

export function TextCoverDialog({
  title,
  seed,
  initialRatio = '4:3',
  fixedRatio = false,
  sources = [],
  sourcePreviews = {},
  onApply,
  onClose,
}: {
  title: string;
  seed: string;
  initialRatio?: ArticleCoverRatio;
  fixedRatio?: boolean;
  sources?: readonly TextCoverSource[];
  sourcePreviews?: Partial<Record<ArticleCoverRatio, string>>;
  onApply(file: File, ratio: ArticleCoverRatio, source: TextCoverSource): Promise<void>;
  onClose(): void;
}) {
  const { messages } = useI18n();
  const copy = messages.contentEditor.textCover;
  const titleId = useId();
  const container = useWorkspacePaneContainer();
  const draft = useTextCoverDrafts(title, seed, initialRatio, sources);
  const { title: text, ratio, recipe } = draft;
  const [fontsReady, setFontsReady] = useState(false);
  const [installedFonts, setInstalledFonts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [error, setError] = useState('');
  const working = useRef(false);
  const reading = useRef(false);
  const mounted = useRef(true);
  const setSourceReading = useCallback((value: boolean) => {
    reading.current = value;
    if (mounted.current) setSourceBusy(value);
  }, []);
  useEffect(() => {
    mounted.current = true;
    void discoverTextCoverFonts().then((fonts) => {
      if (mounted.current) {
        setInstalledFonts(fonts);
        setFontsReady(true);
      }
    });
    return () => {
      mounted.current = false;
    };
  }, []);
  const blocked = busy || sourceBusy;
  const explicitFont = localTextCoverFonts.some((font) => font.id === recipe.font);
  const fontPending = explicitFont && !fontsReady;
  const fontMissing = explicitFont && fontsReady && !installedFonts.includes(recipe.font);
  const canRender = !fontPending && !fontMissing;
  const scene = useMemo(() => buildTextCoverScene(text, recipe, ratio), [text, recipe, ratio]);
  async function save() {
    if (working.current || reading.current || !text.trim() || scene.overflow || !canRender) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      // The rendered image and its editable source must describe the same click.
      const source = captureTextCoverSource(text, ratio, recipe);
      const file = await textCoverPng(buildTextCoverScene(source.title, source.recipe, source.ratio));
      if (!mounted.current) return;
      await onApply(file, source.ratio, source);
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
    if (working.current || reading.current) return;
    draft.update({ recipe: next });
    setError('');
  }
  return (
    <Dialog
      container={container}
      open
      onOpenChange={(open) => {
        if (!open && !working.current) onClose();
      }}
    >
      <DialogContent className="max-w-4xl rounded-md" aria-describedby={undefined} showCloseButton={!busy}>
        <DialogTitle>
          {sources.some((source) => source.ratio === ratio) ? messages.textCoverSource.edit : copy.generate}
        </DialogTitle>
        <fieldset disabled={blocked} className="grid min-w-0 gap-4">
          <div className="grid min-w-0 gap-5 sm:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <div className="grid min-w-0 content-start gap-3">
              {canRender ? (
                <TextCoverArtwork scene={scene} className="max-h-80 w-full" />
              ) : sourcePreviews[ratio] ? (
                <img src={sourcePreviews[ratio]} alt={copy.title} className="max-h-80 w-full object-contain" />
              ) : (
                <div className="grid h-48 place-items-center" aria-busy={fontPending}>
                  {fontPending && <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />}
                </div>
              )}
              <Label htmlFor={titleId}>{copy.title}</Label>
              <Textarea
                id={titleId}
                value={text}
                rows={3}
                maxLength={1000}
                onChange={(event) => {
                  if (working.current || reading.current) return;
                  draft.update({ title: event.target.value });
                  setError('');
                }}
              />
            </div>
            <TextCoverControls
              recipe={recipe}
              ratio={ratio}
              installedFonts={installedFonts}
              onChange={changeRecipe}
              onRatioChange={
                fixedRatio
                  ? undefined
                  : (next) => {
                      if (working.current || reading.current) return;
                      draft.changeRatio(next);
                      setError('');
                    }
              }
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label>{copy.templates}</Label>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => changeRecipe(automaticTextCover(crypto.randomUUID()))}
              >
                <ShuffleIcon className="size-3.5" />
                {copy.shuffle}
              </Button>
              <TextCoverSourceActions
                key={`${seed}:${initialRatio}:${fixedRatio}`}
                title={text}
                recipe={recipe}
                ratio={ratio}
                fixedRatio={fixedRatio}
                busy={blocked}
                onBusyChange={setSourceReading}
                onError={setError}
                onAccept={(source) => {
                  if (working.current || reading.current) return;
                  draft.accept(source);
                  setError('');
                }}
              />
            </div>
          </div>
          <TextCoverPresetPicker title={text} seed={seed} ratio={ratio} recipe={recipe} onChange={changeRecipe} />
        </fieldset>
        {(fontMissing || scene.overflow || error) && (
          <div role="alert" className="text-sm text-destructive">
            {error || (fontMissing ? messages.textCoverSource.savedFontMissing : copy.tooLong)}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {messages.common.cancel}
          </Button>
          <Button
            type="button"
            disabled={blocked || !text.trim() || scene.overflow || !canRender}
            onClick={() => void save()}
          >
            {blocked && <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />}
            {messages.textCoverSource.applyRatio}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

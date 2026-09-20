import { useState, type RefObject } from 'react';
import { ListOrderedIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import type { CreatorPromptComposerHandle } from '@/renderer/components/creator/CreatorPromptComposer';
import { MAX_IMAGE_PROMPTS, readImagePromptPlan } from '@/renderer/components/creator/imagePromptPlan';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/renderer/components/ui/dialog';
import { Label } from '@/renderer/components/ui/label';
import { Textarea } from '@/renderer/components/ui/textarea';
import { useI18n } from '@/renderer/i18n/useI18n';

export function ImagePromptPlanButton({
  composerRef,
  disabled,
}: {
  composerRef: RefObject<CreatorPromptComposerHandle | null>;
  disabled: boolean;
}) {
  const copy = useI18n().messages.creator.imagePromptPlan;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [prompts, setPrompts] = useState<string[]>(['']);

  async function edit() {
    const composer = composerRef.current;
    if (!composer) return;
    setBusy(true);
    setError(false);
    try {
      await composer.whenSettled();
      const saved = readImagePromptPlan(composer.getDocument());
      setPrompts(saved.length ? saved : ['']);
      setOpen(true);
    } catch {
      setError(true);
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" disabled={disabled || busy} onClick={() => void edit()}>
        <ListOrderedIcon className="size-4" />
        {copy.title}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
          </DialogHeader>
          {error ? (
            <div role="alert">{copy.editorBusy}</div>
          ) : (
            <>
              <div className="min-h-0 space-y-4 overflow-y-auto px-1 py-2">
                {prompts.map((prompt, index) => (
                  <div key={index} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor={`image-prompt-${index}`}>
                        {copy.image.replace('{index}', String(index + 1))}
                      </Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={copy.remove}
                        onClick={() => setPrompts((items) => items.filter((_, position) => position !== index))}
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </div>
                    <Textarea
                      id={`image-prompt-${index}`}
                      value={prompt}
                      placeholder={copy.placeholder}
                      onChange={(event) =>
                        setPrompts((items) =>
                          items.map((item, position) => (position === index ? event.target.value : item)),
                        )
                      }
                    />
                  </div>
                ))}
              </div>
              <DialogFooter className="items-center sm:justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={prompts.length >= MAX_IMAGE_PROMPTS}
                  onClick={() => setPrompts((items) => [...items, ''])}
                >
                  <PlusIcon className="size-4" />
                  {copy.add} · {prompts.length}/{MAX_IMAGE_PROMPTS}
                </Button>
                <Button
                  type="button"
                  disabled={prompts.length > MAX_IMAGE_PROMPTS || prompts.some((prompt) => !prompt.trim())}
                  onClick={() => {
                    composerRef.current?.setImagePromptPlan(prompts, copy);
                    setOpen(false);
                  }}
                >
                  {copy.save}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

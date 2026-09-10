import { ArrowRightIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';

export function GifAdoptButton({
  disabled,
  alreadyAdopted,
  hasEditor,
  onAdopt,
}: {
  disabled: boolean;
  alreadyAdopted: boolean;
  hasEditor: boolean;
  onAdopt(): void;
}) {
  const labels = useI18n().messages.creator.gifMaker;
  return (
    <Button data-action="gif-adopt-candidate" size="sm" disabled={disabled} onClick={onAdopt}>
      {alreadyAdopted ? labels.resume : hasEditor ? labels.generation.replaceFrames : labels.generation.adopt}
      <ArrowRightIcon className="size-4" />
    </Button>
  );
}

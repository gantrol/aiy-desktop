import { InfoIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ArticleCoverRatio } from '@/shared/article-covers';

export function ArticleCoverRatioInfo({ ratio }: { ratio: ArticleCoverRatio }) {
  const copy = useI18n().messages.contentEditor.coverEditor;
  const labels: Record<ArticleCoverRatio, string> = {
    '1:1': copy.ratioSquare,
    '3:4': copy.ratioPortrait,
    '4:3': copy.ratioLandscape,
    '16:9': copy.ratioVideo,
    '2.35:1': copy.ratioWide,
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="2xs"
          className="size-5 p-0"
          aria-label={copy.ratioInfo.replace('{ratio}', ratio)}
        >
          <InfoIcon className="size-3" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64">
        {labels[ratio]}
      </TooltipContent>
    </Tooltip>
  );
}

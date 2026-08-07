import { FlaskConicalIcon, LockIcon } from 'lucide-react';
import type { ImageGenerationRouteDto } from '@/shared/contracts';
import { MetaText } from '@/renderer/components/ui/meta-text';
import { StateTag } from '@/renderer/components/ui/state-tag';

interface Props {
  model: ImageGenerationRouteDto;
  name: string;
  previewLabel: string;
  unavailableLabel: string;
}

export function ComparisonModelHeader({ model, name, previewLabel, unavailableLabel }: Props) {
  return (
    <div data-comparison-model-header className="flex min-w-0 flex-1 items-center gap-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium" title={name}>
          {name}
        </span>
        {model.provider && (
          <MetaText className="block truncate" title={model.provider}>
            {model.provider}
          </MetaText>
        )}
      </span>
      {model.releaseStage === 'PREVIEW' && (
        <StateTag tone="info" icon={<FlaskConicalIcon />}>
          {previewLabel}
        </StateTag>
      )}
      {model.state !== 'READY' && (
        <StateTag tone="locked" icon={<LockIcon />}>
          {unavailableLabel}
        </StateTag>
      )}
    </div>
  );
}

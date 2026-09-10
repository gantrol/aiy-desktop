import { ChevronDownIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Textarea } from '@/renderer/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { ModelTargetSelector } from '@/renderer/components/creator/ModelTargetSelector';
import { GenerationQualitySelector } from '@/renderer/components/creator/GenerationQualitySelector';
import { GifChoice, GifNumber } from '@/renderer/features/gif-making/GifSettings';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { GifGenerationModel } from '@/renderer/features/gif-making/useGifGeneration';
import { GifPlanReview } from '@/renderer/features/gif-making/GifPlanReview';

export function GifGenerationPanel({
  motion,
  disabled,
  selectedPlanState,
  onSelectedPlanStateChange,
}: {
  motion: GifGenerationModel;
  disabled: boolean;
  selectedPlanState?: number;
  onSelectedPlanStateChange?(index: number): void;
}) {
  const { locale, messages } = useI18n();
  const labels = messages.creator.gifMaker.generation;
  const locked = disabled || motion.running || motion.adopting;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const needsModel =
    Boolean(motion.plan) && !motion.routes.some((route) => route.key === motion.modelKey && route.state === 'READY');
  return (
    <section className="min-w-0" aria-label={labels.prepare}>
      <fieldset disabled={locked} className="min-w-0 space-y-4">
        <label className="block space-y-2 text-sm font-medium">
          {labels.prompt}
          <Textarea
            aria-label={labels.prompt}
            data-control="gif-motion-prompt"
            placeholder={labels.placeholder}
            maxLength={4000}
            value={motion.prompt}
            onChange={(event) => motion.setPrompt(event.target.value)}
            className="min-h-24 resize-y font-normal"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <GifChoice
            label={labels.returnMode}
            value={motion.returnMode}
            options={[
              { value: 'CONTINUE', label: labels.continueReturn },
              { value: 'REVERSE', label: labels.reverseReturn },
              { value: 'ONE_WAY', label: labels.oneWay },
            ]}
            onChange={motion.setReturnMode}
          />
          <GifNumber
            label={labels.duration}
            value={motion.durationMs}
            min={400}
            max={10000}
            step={10}
            onChange={motion.setDurationMs}
          />
        </div>
        <Collapsible open={settingsOpen || needsModel} onOpenChange={setSettingsOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group px-0">
              <ChevronDownIcon className="size-3 transition-transform group-data-[state=open]:rotate-180" />
              {labels.settings}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-3">
            <GifChoice
              label={labels.generationMode}
              value={motion.generationMode}
              options={[
                { value: 'FRAMES', label: labels.individualFrames },
                { value: 'SHEET', label: labels.singleSheet },
              ]}
              onChange={motion.setGenerationMode}
            />
            <ModelTargetSelector
              routes={motion.routes}
              selectedModelKeys={motion.modelKey ? [motion.modelKey] : []}
              onSelectedModelKeysChange={(keys) =>
                motion.setModelKey(keys.find((key) => key !== motion.modelKey) ?? keys[0] ?? '')
              }
            />
            <GenerationQualitySelector
              locale={locale}
              routes={motion.routes}
              targets={motion.modelKey ? [{ modelKey: motion.modelKey, count: 1, quality: motion.quality }] : []}
              onTargetsChange={(targets) => {
                if (targets[0]) motion.setQuality(targets[0].quality);
              }}
            />
          </CollapsibleContent>
        </Collapsible>
        <GifPlanReview
          motion={motion}
          disabled={locked}
          selectedIndex={selectedPlanState}
          onSelectedIndexChange={onSelectedPlanStateChange}
        />
      </fieldset>
    </section>
  );
}

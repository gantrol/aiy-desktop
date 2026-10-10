import { ChevronDownIcon } from 'lucide-react';
import type { ExtensionContributionPoint, ExtensionDto } from '@/shared/contracts';
import { EXTENSION_HOST_ENGINE_KEY } from '@/shared/product';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { useI18n } from '@/renderer/i18n/useI18n';

const contributionOrder: ExtensionContributionPoint[] = [
  'contentApplications',
  'deliveryChannels',
  'modelProviders',
  'metricProviders',
  'tools',
  'workflows',
  'commands',
  'searchProviders',
  'filters',
  'fields',
  'themes',
];

/** Package metadata stays available without displacing the extension's configuration. */
export function ExtensionPackageDetails({ extension }: { extension: ExtensionDto }) {
  const l = useI18n().messages.extensions;
  const fields = [
    { key: 'manifest', value: extension.manifest.manifestVersion },
    { key: 'engine', value: extension.manifest.engines[EXTENSION_HOST_ENGINE_KEY] },
    { key: 'source', value: l.source[extension.source] },
    { key: 'compatibility', value: extension.compatible ? l.compatible : l.incompatible },
    ...(extension.manifest.runtime ? [{ key: 'runtime' as const, value: extension.manifest.runtime.id }] : []),
  ] as const;
  const contributions = contributionOrder.flatMap((point) =>
    (extension.manifest.contributes[point] ?? []).map((value) => ({ point, value })),
  );
  return (
    <Collapsible defaultOpen={!extension.compatible} className="border-t pt-2">
      <h3>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="group w-full justify-between px-2 text-muted-foreground"
          >
            {l.sections.details}
            <ChevronDownIcon className="size-4 -rotate-90 transition-transform group-data-[state=open]:rotate-0 motion-reduce:transition-none" />
          </Button>
        </CollapsibleTrigger>
      </h3>
      <CollapsibleContent>
        <div className="grid gap-5 px-2 pb-2 pt-3">
          <dl className="grid gap-x-5 gap-y-4 @md/extension-detail:grid-cols-2 @2xl/extension-detail:grid-cols-3">
            <div className="col-span-full">
              <dt className="text-xs text-muted-foreground">{l.fields.identifier}</dt>
              <dd className="mt-1 break-all text-sm">{extension.manifest.id}</dd>
            </div>
            {fields.map(({ key, value }) => (
              <div key={key}>
                <dt className="text-xs text-muted-foreground">{l.fields[key]}</dt>
                <dd className="mt-1 break-words text-sm">{value}</dd>
              </div>
            ))}
          </dl>
          {contributions.length > 0 && (
            <section>
              <h4 className="text-xs font-medium text-muted-foreground">{l.sections.contributions}</h4>
              <ul className="mt-2 divide-y">
                {contributions.map(({ point, value }) => (
                  <li
                    key={`${point}:${value}`}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-xs"
                  >
                    <span className="min-w-0 break-all">{value}</span>
                    <span className="text-muted-foreground">{l.contributionPoints[point]}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

import { BookOpenIcon, ExternalLinkIcon, ImageIcon, PackageIcon, SquarePenIcon } from 'lucide-react';
import type {
  AssetCreationInputPackUseDto,
  AssetCreationRelationshipDto,
  AssetRelationshipDto,
  AssetRelationshipRecipeUseDto,
  AssetRelationshipTermUseDto,
  Locale,
} from '@/shared/contracts';
import { resolveLocalizedName } from '@/shared/word-palette-localization';
import { DictionaryIcon } from '@/renderer/icons';
import { Badge } from '@/renderer/components/ui/badge';
import { MetaText } from '@/renderer/components/ui/meta-text';

interface Props {
  relationships: AssetRelationshipDto;
  assetId: string;
  locale: Locale;
  onOpenResult(seriesId: string, assetId: string): void;
  onOpenTerm(termId: string): void;
}

const labels = {
  zh: {
    creation: '创作来源',
    generated: '生成运行',
    imported: '导入产出',
    version: (version: number) => `V${String(version).padStart(2, '0')}`,
    unlinkedVersion: '未关联 Prompt 版本',
    deletedSeries: '创作已删除',
    creationPacks: '创作使用的资料包',
    directPacks: '来自资料包',
    termRelationships: '词条证据／示例',
    evidence: '证据',
    media: '示例',
    recipe: '配方',
  },
  en: {
    creation: 'Creation source',
    generated: 'Generation run',
    imported: 'Imported output',
    version: (version: number) => `V${String(version).padStart(2, '0')}`,
    unlinkedVersion: 'No linked Prompt version',
    deletedSeries: 'Creation deleted',
    creationPacks: 'Packs used by creation',
    directPacks: 'Provided by packs',
    termRelationships: 'Term evidence / examples',
    evidence: 'Evidence',
    media: 'Example',
    recipe: 'Recipe',
  },
} satisfies Record<Locale, Record<string, unknown>>;

function localizedTermTitle(
  item: { title: string; titleLocale: string; localizations: Array<{ locale: string; title: string }> },
  locale: Locale,
) {
  if (item.titleLocale === locale) return item.title;
  return item.localizations.find((localization) => localization.locale === locale)?.title || item.title;
}

function TermChip({ term, locale }: { term: AssetRelationshipTermUseDto; locale: Locale }) {
  return (
    <Badge
      variant="secondary"
      className="max-w-full whitespace-normal break-words text-left"
      data-asset-direct-term={term.termId}
    >
      {localizedTermTitle(term, locale)}
    </Badge>
  );
}

function RecipeChip({ recipe, locale }: { recipe: AssetRelationshipRecipeUseDto; locale: Locale }) {
  return (
    <Badge
      variant="outline"
      className="max-w-full gap-1 whitespace-normal break-words text-left"
      data-asset-recipe={recipe.paletteId}
    >
      <DictionaryIcon className="size-3 shrink-0" />
      {resolveLocalizedName(recipe, locale)}
    </Badge>
  );
}

function InputPackCard({ use, locale }: { use: AssetCreationInputPackUseDto; locale: Locale }) {
  return (
    <div className="min-w-0 rounded-md border bg-background/70 p-2.5" data-creation-pack-source={use.pack.packId}>
      <div className="flex min-w-0 items-start gap-2">
        <PackageIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{use.pack.packDisplayName}</span>
        <MetaText className="min-w-0 max-w-[55%] break-all text-right leading-4">
          {use.pack.packReleaseVersion}
        </MetaText>
      </div>
      {(use.viaDirectTerms.length > 0 || use.viaRecipes.length > 0 || use.viaReferences.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {use.viaDirectTerms.map((term) => (
            <TermChip key={`${term.termId}:${term.termRevisionId}`} term={term} locale={locale} />
          ))}
          {use.viaRecipes.map((recipe) => (
            <RecipeChip key={`${recipe.useId}:${recipe.paletteRevisionId}`} recipe={recipe} locale={locale} />
          ))}
          {use.viaReferences.length > 0 && (
            <Badge variant="outline" className="gap-1">
              <ImageIcon className="size-3" />
              {use.viaReferences.length}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

function CreationCard({
  relationship,
  assetId,
  locale,
  onOpenResult,
}: {
  relationship: AssetCreationRelationshipDto;
  assetId: string;
  locale: Locale;
  onOpenResult(seriesId: string, assetId: string): void;
}) {
  const copy = labels[locale];
  const title = relationship.series.title;
  const relationshipType = relationship.kind === 'GENERATION_RUN' ? copy.generated : copy.imported;
  const version = relationship.promptVersion
    ? copy.version(relationship.promptVersion.versionNo)
    : copy.unlinkedVersion;
  const canOpen = !relationship.series.deletedAt;
  const header = (
    <>
      <SquarePenIcon className="size-4 shrink-0 text-relation-referenced" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <MetaText className="block">
          {relationshipType} · {version}
          {relationship.modelKey ? ` · ${relationship.modelKey}` : ''}
        </MetaText>
      </span>
      {canOpen && <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground" />}
    </>
  );

  return (
    <article className="min-w-0 rounded-md border bg-background p-3" data-creation-relationship={relationship.kind}>
      {canOpen ? (
        <button
          type="button"
          className="flex w-full min-w-0 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onOpenResult(relationship.series.id, assetId)}
        >
          {header}
        </button>
      ) : (
        <div className="flex items-center gap-3">{header}</div>
      )}
      {relationship.series.deletedAt && <MetaText className="mt-2 block">{copy.deletedSeries}</MetaText>}
      {relationship.promptVersion?.userInstruction.trim() && (
        <p className="mt-3 whitespace-pre-wrap break-words text-xs leading-5">
          {relationship.promptVersion.userInstruction}
        </p>
      )}
      {(relationship.directTerms.length > 0 || relationship.recipes.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {relationship.directTerms.map((term) => (
            <TermChip key={`${term.termId}:${term.termRevisionId}`} term={term} locale={locale} />
          ))}
          {relationship.recipes.map((recipe) => (
            <RecipeChip key={`${recipe.useId}:${recipe.paletteRevisionId}`} recipe={recipe} locale={locale} />
          ))}
        </div>
      )}
      {relationship.inputPackSources.length > 0 && (
        <section className="mt-3 grid min-w-0 gap-2 border-t pt-3">
          <MetaText className="font-medium">{copy.creationPacks}</MetaText>
          {relationship.inputPackSources.map((use) => (
            <InputPackCard key={`${use.pack.packId}:${use.pack.packReleaseId}`} use={use} locale={locale} />
          ))}
        </section>
      )}
    </article>
  );
}

export function MaterialRelationships({ relationships, assetId, locale, onOpenResult, onOpenTerm }: Props) {
  const copy = labels[locale];
  return (
    <div className="grid min-w-0 gap-4" data-asset-relationships={relationships.assetId}>
      {relationships.creations.length > 0 && (
        <section className="grid min-w-0 gap-2">
          <MetaText className="font-medium">{copy.creation}</MetaText>
          {relationships.creations.map((relationship) => (
            <CreationCard
              key={relationship.runId ?? relationship.importedOutputId!}
              relationship={relationship}
              assetId={assetId}
              locale={locale}
              onOpenResult={onOpenResult}
            />
          ))}
        </section>
      )}

      {relationships.termRelationships.length > 0 && (
        <section className="grid min-w-0 gap-2">
          <MetaText className="font-medium">{copy.termRelationships}</MetaText>
          {relationships.termRelationships.map((relationship) => (
            <button
              key={`${relationship.kind}:${relationship.id}`}
              type="button"
              className="flex w-full items-center gap-3 rounded-md border bg-background p-3 text-left text-sm outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onOpenTerm(relationship.termId)}
              data-term-relationship={relationship.kind}
            >
              <BookOpenIcon className="size-4 shrink-0 text-relation-referenced" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{localizedTermTitle(relationship, locale)}</span>
                <MetaText className="block">
                  {relationship.kind === 'EVIDENCE' ? copy.evidence : copy.media}
                  {relationship.verdict ? ` · ${relationship.verdict}` : ''}
                  {relationship.mediaRole ? ` · ${relationship.mediaRole}` : ''}
                </MetaText>
                {relationship.note && <span className="mt-1 block line-clamp-2 text-xs">{relationship.note}</span>}
              </span>
              <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </section>
      )}

      {relationships.directPackSources.length > 0 && (
        <section className="grid min-w-0 gap-2" data-direct-pack-sources>
          <MetaText className="font-medium">{copy.directPacks}</MetaText>
          {relationships.directPackSources.map((source) => (
            <div
              key={source.id}
              className="min-w-0 rounded-md border bg-background p-3"
              data-direct-pack-source={source.pack.packId}
            >
              <div className="flex min-w-0 items-start gap-2">
                <PackageIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{source.pack.packDisplayName}</span>
                <MetaText className="min-w-0 max-w-[55%] break-all text-right leading-4">
                  {source.pack.packReleaseVersion}
                </MetaText>
              </div>
              <MetaText className="mt-1 block break-all leading-4">
                {source.releaseItem.itemKey} · {source.mappingKind}
              </MetaText>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

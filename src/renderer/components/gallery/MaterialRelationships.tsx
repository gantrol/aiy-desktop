import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
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
import { useAssetNavigation } from '@/renderer/components/media/AssetNavigationProvider';

interface Props {
  relationships: AssetRelationshipDto;
  assetId: string;
  locale: Locale;
  onOpenResult(seriesId: string, assetId: string, versionId?: string): void;
  onOpenTerm(termId: string): void;
}

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
  onOpenResult(seriesId: string, assetId: string, versionId?: string): void;
}) {
  const copy = useI18n().messages.gallery.sourceRelationships;
  const navigation = useAssetNavigation();
  const title = relationship.series.title;
  const relationshipType = relationship.kind === 'GENERATION_RUN' ? copy.generated : copy.imported;
  const version = relationship.promptVersion
    ? `V${String(relationship.promptVersion.versionNo).padStart(2, '0')}`
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
        <Button
          variant="ghost"
          type="button"
          className="h-auto w-full min-w-0 justify-start gap-3 whitespace-normal p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={navigation?.busyAssetId === assetId}
          onClick={() =>
            navigation
              ? void navigation.open(assetId, 'SOURCES', {
                  kind: 'CREATION',
                  id: relationship.series.id,
                  versionId: relationship.promptVersion?.id ?? null,
                })
              : onOpenResult(relationship.series.id, assetId, relationship.promptVersion?.id)
          }
        >
          {header}
        </Button>
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
  const copy = useI18n().messages.gallery.sourceRelationships;
  const navigation = useAssetNavigation();
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
            <Button
              variant="ghost"
              key={`${relationship.kind}:${relationship.id}`}
              type="button"
              className="h-auto w-full justify-start gap-3 whitespace-normal rounded-md border bg-background p-3 text-left text-sm outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
              disabled={navigation?.busyAssetId === assetId}
              onClick={() =>
                navigation
                  ? void navigation.open(assetId, 'SOURCES', { kind: 'TERM', id: relationship.termId })
                  : onOpenTerm(relationship.termId)
              }
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
            </Button>
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

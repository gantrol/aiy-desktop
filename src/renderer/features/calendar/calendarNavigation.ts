import { initialAppLocation, type AppLocation } from '@/renderer/components/app/app-navigation';
import type { BootstrapDto } from '@/shared/contracts';
import type { CalendarItem } from '@/shared/contracts/calendar';

/** Only exact, supported destinations are returned; IDs are never reinterpreted as another content type. */
function availableCalendarSource(item: Pick<CalendarItem, 'entity'>) {
  const original = item.entity;
  if (!original?.available) return null;
  return original.navigateTo === undefined ? original : original.navigateTo;
}

export function calendarSourceLocation(item: Pick<CalendarItem, 'entity'>, data: BootstrapDto): AppLocation | null {
  const entity = availableCalendarSource(item);
  if (!entity) return null;
  const id = entity.id;
  const creator = (location: AppLocation['creator']): AppLocation => ({
    ...initialAppLocation,
    creator: location,
  });
  switch (entity.type) {
    case 'ARTICLE':
      return data.articles?.some((entry) => entry.id === id) ? creator({ surface: 'article', articleId: id }) : null;
    case 'SOCIAL_POST':
      return data.socialPosts?.some((entry) => entry.id === id)
        ? creator({ surface: 'social-post', postId: id })
        : null;
    case 'INSPIRATION_STASH':
      return data.inspirationStashes?.some((entry) => entry.id === id)
        ? creator({ surface: 'inspiration-stash', stashId: id })
        : null;
    case 'PROMPT_SERIES':
      return data.series.some((entry) => entry.id === id)
        ? creator({ surface: 'existing-creation', seriesId: id, assetId: null })
        : null;
    case 'CREATION':
      return data.creations?.some((entry) => entry.id === id)
        ? creator({ surface: 'idea-creation', creationId: id })
        : null;
    case 'ALBUM':
      return data.albums.some((entry) => entry.id === id) ? creator({ surface: 'album-detail', albumId: id }) : null;
    case 'MATERIAL_ALBUM':
      return {
        ...initialAppLocation,
        view: 'gallery',
        gallery: { collection: { kind: 'album', albumId: id }, requestedMaterialId: null, selectedMaterialKey: null },
      };
    case 'IMAGE_BREAKDOWN':
      return data.imageBreakdowns?.some((entry) => entry.id === id)
        ? creator({ surface: 'image-breakdown', breakdownId: id })
        : null;
    case 'EVALUATION_SUITE':
      return data.evaluationSuites?.some((entry) => entry.id === id)
        ? creator({ surface: 'evaluation-suite', suiteId: id })
        : null;
    case 'TERM':
      return data.terms.some((entry) => entry.id === id)
        ? {
            ...initialAppLocation,
            view: 'dictionary',
            dictionary: { surface: 'detail', termId: id, browseContext: null },
          }
        : null;
    case 'VIDEO_DOCUMENT':
      return { ...initialAppLocation, view: 'documents', documents: { collection: { kind: 'all' }, documentId: id } };
    case 'MATERIAL':
      return {
        ...initialAppLocation,
        view: 'gallery',
        gallery: { collection: { kind: 'all' }, requestedMaterialId: id, selectedMaterialKey: null },
      };
    default:
      return null;
  }
}

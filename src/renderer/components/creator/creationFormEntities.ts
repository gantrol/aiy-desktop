import type { CreationFormEntityKind, CreationItemDto } from '@/shared/contracts';

export function creationItemByFormEntity(
  items: readonly CreationItemDto[],
  kind: CreationFormEntityKind,
  entityId: string,
) {
  return (
    items.find((item) => item.forms.some((form) => form.entity.kind === kind && form.entity.id === entityId)) ?? null
  );
}

export function creationFormByEntity(
  items: readonly CreationItemDto[],
  kind: CreationFormEntityKind,
  entityId: string,
) {
  const item = creationItemByFormEntity(items, kind, entityId);
  const form = item?.forms.find((candidate) => candidate.entity.kind === kind && candidate.entity.id === entityId);
  return item && form ? { item, form } : null;
}

import type { BootstrapDto, CreationFormEntityRef } from '@/shared/contracts';
import { creationFormByEntity } from '@/renderer/components/creator/creationFormEntities';
import {
  compareCreationForms,
  creationFormTitle,
  projectCreationForm,
} from '@/renderer/components/creator/creationLibraryProjection';
import { useCreationWorkIndex } from '@/renderer/components/creator/useCreationWorkIndex';
import { creationWorkTitleSuffixes } from '@/renderer/components/creator/creationWorkTitles';
import { useI18n } from '@/renderer/i18n/useI18n';

export interface CreationWorksScope {
  data: BootstrapDto;
  activeEntity: CreationFormEntityRef | null;
  activeCreationItemId?: string;
  sourceFormId?: string;
}

/** Project the existing work index; opening a list never fetches each work's body. */
export function useCreationWorks({ data, activeEntity, activeCreationItemId, sourceFormId }: CreationWorksScope) {
  const labels = useI18n().messages.creator.album;
  const context = activeEntity ? creationFormByEntity(data.creationItems, activeEntity.kind, activeEntity.id) : null;
  const index = useCreationWorkIndex(data);
  const item = context?.item ?? data.creationItems.find((item) => item.id === activeCreationItemId);
  const forms = (item?.forms ?? [])
    .filter((form) => form.entity.kind !== 'DERIVED_VISUAL')
    .sort(compareCreationForms)
    .map((form) => projectCreationForm(form, index))
    .filter((form) => form.entity || form.entityRef.kind === 'VIDEO_DOCUMENT');
  const selectedId = context?.form.entity.kind === 'DERIVED_VISUAL' ? context.form.sourceFormId : context?.form.id;
  const suffixes = creationWorkTitleSuffixes(
    forms.map((form) => ({ id: form.entityRef.id, title: `${form.role}:${creationFormTitle(form, labels)}` })),
  );
  const source = item?.forms.find((form) => form.id === (context?.form.sourceFormId ?? sourceFormId));
  return { context, forms, selectedId, suffixes, source: source ? projectCreationForm(source, index) : null };
}

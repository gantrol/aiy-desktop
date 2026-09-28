import {
  creationFormActivityAt,
  type CreationFormProjection,
} from '@/renderer/components/creator/creationLibraryProjection';

export interface CreationAnimationGroup {
  key: string;
  forms: CreationFormProjection[];
}

/** Keep a creation's animations together across generations, copies, and drafts. */
export function groupCreationAnimationForms(forms: readonly CreationFormProjection[]): CreationAnimationGroup[] {
  const groups = new Map<string, CreationAnimationGroup>();
  for (const form of forms) {
    const key = form.role === 'ANIMATION' ? `animations:${form.form.creationItemId}` : `form:${form.form.id}`;
    const group = groups.get(key);
    if (group) group.forms.push(form);
    else groups.set(key, { key, forms: [form] });
  }
  return [...groups.values()];
}

export function animationGroupOpenTarget(group: CreationAnimationGroup, selectedFormId: string | null) {
  return (
    group.forms.find((form) => form.form.id === selectedFormId) ??
    group.forms.reduce((latest, form) =>
      creationFormActivityAt(form) > creationFormActivityAt(latest) ? form : latest,
    )
  );
}

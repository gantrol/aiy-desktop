import type { BootstrapDto } from '@/shared/contracts';
import type { CreatorOpenTabTarget } from '@/renderer/components/app/app-navigation';
import { CreationWorksMenu } from '@/renderer/components/creator/CreationWorksMenu';
import { creationFormByEntity } from '@/renderer/components/creator/creationFormEntities';
import { creationFormTabTarget } from '@/renderer/components/creator/creationFormTabTarget';
import { useI18n } from '@/renderer/i18n/useI18n';

export function GifWorkNavigation({
  data,
  documentId,
  save,
  refresh,
  onOpenWork,
  notify,
}: {
  data: BootstrapDto;
  documentId: string;
  save(): Promise<unknown>;
  refresh(): Promise<boolean>;
  onOpenWork(target: CreatorOpenTabTarget): void;
  notify(message: string): void;
}) {
  const { locale } = useI18n();
  const context = creationFormByEntity(data.creationItems, 'GIF_DOCUMENT', documentId);
  return (
    <CreationWorksMenu
      data={data}
      activeEntity={{ kind: 'GIF_DOCUMENT', id: documentId }}
      notify={notify}
      onSelect={async (form) => {
        const item = data.creationItems.find((item) => item.id === form.form.creationItemId);
        const target = creationFormTabTarget(form, item?.albumId ?? null);
        if (!target) return;
        await save();
        await refresh();
        onOpenWork(target);
      }}
      onCreateAnother={
        context
          ? async () => {
              await save();
              const draft = await window.desktopApi.creationDraftStart({
                albumId: context.item.albumId,
                termPromptLocale: locale,
                startMode: 'manuscript',
                creationSource: { kind: 'FORM', id: context.form.id },
              });
              await refresh();
              onOpenWork({ view: 'creator', location: { surface: 'creation-draft', draftId: draft.id } });
            }
          : undefined
      }
    />
  );
}

import { Button } from '@/renderer/components/ui/button';
import { WorkItemDetails } from '@/renderer/features/work-tracking/WorkDetails';
import { WorkSourcePreview } from '@/renderer/features/work-tracking/WorkSourcePreview';
import { useWorkTableEditing } from '@/renderer/features/work-tracking/WorkTableEditing';
import { openAppContentLink } from '@/renderer/components/app/app-content-link';
import { contentLinkUrl } from '@/shared/contracts/content-links';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { WorkItem } from '@/shared/contracts/work-tracking';

export function WorkItemPane({
  item,
  articleId,
  onEdit,
  onDelegate,
  onTask,
  onClose,
  notify,
}: {
  item?: WorkItem;
  articleId: string;
  onEdit(): void;
  onDelegate(): void;
  onTask(id: string): void;
  onClose(): void;
  notify(message: string): void;
}) {
  const l = useI18n().messages.workTracking;
  const edit = useWorkTableEditing();
  const open = () => {
    if (!openAppContentLink(contentLinkUrl({ spaceId: edit.data.spaceId, target: { kind: 'ARTICLE', id: articleId } })))
      notify(l.noSource);
  };
  return (
    <div className="grid content-start gap-4">
      <div className="flex items-start justify-between gap-2">
        <strong className="min-w-0 break-words">{edit.article(articleId)?.content.title || l.untitled}</strong>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {l.close}
        </Button>
      </div>
      <WorkSourcePreview articleId={articleId} />
      {item ? (
        <WorkItemDetails
          item={item}
          snapshot={edit.snapshot}
          busy={edit.busy}
          onEdit={onEdit}
          onDelegate={onDelegate}
          onTask={onTask}
          onOpen={open}
        />
      ) : (
        <Button variant="outline" size="sm" onClick={open}>
          {l.openSource}
        </Button>
      )}
    </div>
  );
}

import type { ContentCommentModelAuthor } from '@/shared/contracts/content-comments';
import { ModelIdentity } from '@/renderer/components/model/ModelIdentity';

export function ContentCommentModelIdentity({
  author,
  className,
}: {
  author: ContentCommentModelAuthor;
  className?: string;
}) {
  return <ModelIdentity providerKey={author.providerKey} modelId={author.modelId} className={className} />;
}

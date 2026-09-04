import type { ArticleCommentModelAuthor } from '@/shared/contracts';
import { ModelIdentity } from '@/renderer/components/model/ModelIdentity';

export function ArticleCommentModelIdentity({
  author,
  className,
}: {
  author: ArticleCommentModelAuthor;
  className?: string;
}) {
  return <ModelIdentity providerKey={author.providerKey} modelId={author.modelId} className={className} />;
}

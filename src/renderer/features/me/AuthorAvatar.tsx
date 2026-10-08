import { UserRoundIcon } from 'lucide-react';
import type { Author } from '@/shared/contracts/me';
import { ProfileAvatar } from '@/renderer/features/me/ProfileAvatar';
import { CodexIcon } from '@/renderer/icons';
import { cn } from '@/renderer/lib/utils';

export function AuthorAvatar({
  author,
  className,
}: {
  author: Pick<Author, 'kind' | 'application' | 'avatarDataUrl'>;
  className?: string;
}) {
  if (author.avatarDataUrl || author.kind !== 'AI')
    return <ProfileAvatar src={author.avatarDataUrl} className={className} />;

  const Icon = author.application === 'codex' ? CodexIcon : UserRoundIcon;
  return <Icon aria-hidden="true" className={cn('size-10 shrink-0', className)} />;
}

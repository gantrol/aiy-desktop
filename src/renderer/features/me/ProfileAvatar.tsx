import { UserRoundIcon } from 'lucide-react';
import { cn } from '@/renderer/lib/utils';

export function ProfileAvatar({ src, className }: { src?: string | null; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-muted-foreground',
        className,
      )}
    >
      {src ? <img src={src} alt="" className="size-full object-cover" /> : <UserRoundIcon className="size-1/2" />}
    </span>
  );
}

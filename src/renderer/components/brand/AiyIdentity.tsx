import artwork from '../../assets/aiy-reading.png?url';
import { cn } from '@/renderer/lib/utils';

export const aiyIdentityUrl = artwork;

/** The same original artwork is used for full covers and a face-focused avatar. */
export function AiyIdentity({ className, avatar = false }: { className?: string; avatar?: boolean }) {
  return (
    <span className={cn('relative inline-block overflow-hidden', className)}>
      <img
        data-aiy-identity
        src={artwork}
        alt=""
        draggable={false}
        className="block size-full object-contain"
        style={avatar ? { transformOrigin: 'top left', transform: 'translate(-86%, -2.5%) scale(2.5)' } : undefined}
      />
    </span>
  );
}

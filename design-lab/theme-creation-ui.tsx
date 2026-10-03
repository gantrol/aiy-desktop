import type { ReactNode } from 'react';
import { FileTextIcon, ImageIcon, ListTreeIcon, type LucideIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/renderer/components/ui/dropdown-menu';
import { kinds, type Copy, type Kind } from './theme-creation-types';

export const kindIcons: Record<Kind, LucideIcon> = { article: FileTextIcon, outline: ListTreeIcon, image: ImageIcon };
export function IconButton({
  label,
  onClick,
  children,
  disabled = false,
}: {
  label: string;
  onClick(): void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Button variant="ghost" size="icon-sm" title={label} aria-label={label} onClick={onClick} disabled={disabled}>
      {children}
    </Button>
  );
}
export function Menu({
  label,
  children,
  icon,
  compact = false,
}: {
  label: string;
  children: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={compact ? 'icon-sm' : 'sm'} aria-label={label} title={label}>
          {icon}
          {!compact && label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}
export function KindSelect({
  value,
  onChange,
  copy,
  label,
}: {
  value: Kind;
  onChange(value: Kind): void;
  copy: Copy;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as Kind)}>
      <SelectTrigger className="h-8 w-28" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {kinds.map((kind) => (
          <SelectItem key={kind} value={kind}>
            {copy[kind]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function Cover({ title, variant = 0, copy }: { title: string; variant?: number; copy: Copy }) {
  return (
    <svg
      role="img"
      aria-label={title}
      viewBox="0 0 600 430"
      className="mx-auto block max-h-[48dvh] w-full bg-surface-sunken text-foreground"
    >
      <rect x="24" y="24" width="552" height="382" fill="none" stroke="currentColor" strokeOpacity=".28" />
      {variant === 0 ? (
        <>
          <text x="56" y="78" fontSize="14" fill="currentColor" opacity=".55">
            {copy.coverEyebrow}
          </text>
          <text x="56" y="147" fontSize="28" fill="currentColor">
            {title.slice(0, 17)}
          </text>
          <path
            d="M330 225l-103-25v116l103 29 103-29V200z M330 225v120"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="M250 236l60 15m-60 9l60 15m41-24l59-15m-59 39l59-15"
            fill="none"
            stroke="currentColor"
            opacity=".35"
          />
        </>
      ) : (
        <>
          <rect x="66" y="66" width="468" height="210" fill="none" stroke="currentColor" strokeOpacity=".35" />
          <path
            d="M66 238l132-92 84 61 83-112 169 181 M397 66v210"
            fill="none"
            stroke="currentColor"
            strokeOpacity=".35"
          />
          <text x="66" y="330" fontSize="27" fill="currentColor">
            {title.slice(0, 17)}
          </text>
          <text x="66" y="364" fontSize="13" fill="currentColor" opacity=".55">
            {copy.coverEyebrow}
          </text>
        </>
      )}
    </svg>
  );
}

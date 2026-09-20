import { Button } from '@/renderer/components/ui/button';

/** The rail toggles immediate child branches; their titles and the owner stay visible. */
export function OutlineBranchRail({
  action,
}: {
  action: { expanded: boolean; label: string; onToggle(): void } | null;
}) {
  const line = (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-current opacity-20 group-hover/outline-rail:w-px group-hover/outline-rail:opacity-100 group-focus-visible/outline-rail:w-px group-focus-visible/outline-rail:opacity-100"
    />
  );
  if (!action)
    return (
      <span
        aria-hidden="true"
        contentEditable={false}
        data-outline-rail
        className="pointer-events-none absolute bottom-1 left-1 top-7 w-4 text-border-strong"
      >
        {line}
      </span>
    );
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      contentEditable={false}
      data-outline-control
      data-outline-rail
      data-state={action.expanded ? 'open' : 'closed'}
      aria-label={action.label}
      aria-expanded={action.expanded}
      title={action.label}
      className="group/outline-rail absolute bottom-1 left-1 top-7 z-10 h-auto min-h-2 w-4 rounded-none p-0 text-border-strong hover:bg-transparent hover:text-[var(--hierarchy-accent)] focus-visible:text-[var(--hierarchy-accent)] focus-visible:ring-offset-0"
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation();
        action.onToggle();
      }}
    >
      {line}
    </Button>
  );
}

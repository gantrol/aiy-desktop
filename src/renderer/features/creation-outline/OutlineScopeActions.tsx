import { ArrowUpRightIcon, PlusIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { CreationOrganizationAction } from '@/renderer/features/creation-outline/CreationOrganizationAction';
import { OutlineNodeMenu } from '@/renderer/features/creation-outline/OutlineNodeMenu';

type Props = Omit<ComponentProps<typeof OutlineNodeMenu>, 'onOpen' | 'onMove' | 'onFocus' | 'onOpenSource'> & {
  onOpenNode(node: NonNullable<ComponentProps<typeof OutlineNodeMenu>['node']>): void;
  onMoveNode(node: NonNullable<ComponentProps<typeof OutlineNodeMenu>['node']>): void;
  onOpenSourceNode(node: NonNullable<ComponentProps<typeof OutlineNodeMenu>['node']>): void;
};

export function OutlineScopeActions({ onOpenNode, onMoveNode, onOpenSourceNode, ...props }: Props) {
  const labels = useI18n().messages.creator.outline;
  const { node, actions, busy, organization } = props;
  const open = () => {
    if (node) onOpenNode(node);
  };
  return (
    <div className="flex items-center gap-1">
      {!node || node.kind === 'album' ? (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => actions.newCreation(node?.target?.id ?? null)}>
          <PlusIcon className="size-3.5" />
          {labels.newCreation}
        </Button>
      ) : node.kind === 'creation' && node.target ? (
        <CreationOrganizationAction
          {...organization}
          target={{ kind: 'creation', id: node.target.id, title: node.title }}
          busy={busy}
          renderTrigger={(action) => (
            <Button variant="ghost" size="sm" {...action}>
              <PlusIcon className="size-3.5" />
              {labels.createChild}
            </Button>
          )}
        />
      ) : (
        <Button variant="ghost" size="sm" disabled={busy} onClick={open}>
          <ArrowUpRightIcon className="size-3.5" />
          {node.content ? labels.editContent : labels.open}
        </Button>
      )}
      <OutlineNodeMenu
        {...props}
        onOpen={open}
        onMove={() => {
          if (node) onMoveNode(node);
        }}
        onOpenSource={node?.content?.referenceId ? () => onOpenSourceNode(node) : undefined}
      />
    </div>
  );
}

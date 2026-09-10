import { createContext, useContext, type ComponentProps } from 'react';
import {
  CreationRelationsButton,
  CreationWorksMenu,
  type CreationRelationsAction,
} from '@/renderer/components/creator/CreationWorksMenu';

export const CreationWorkNavigationContext = createContext<ComponentProps<typeof CreationWorksMenu> | null>(null);

export function CreationWorkNavigation({ relationsAction }: { relationsAction?: CreationRelationsAction }) {
  const navigation = useContext(CreationWorkNavigationContext);
  return navigation ? (
    <CreationWorksMenu
      key={`${navigation.activeEntity?.kind}:${navigation.activeEntity?.id}`}
      {...navigation}
      relationsAction={relationsAction}
    />
  ) : (
    <CreationRelationsButton action={relationsAction} />
  );
}

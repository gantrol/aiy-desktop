import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

const PopoverNavigationContext = createContext({ active: true });

export function PopoverNavigationScope({
  active,
  navigationKey,
  children,
}: {
  active: boolean;
  navigationKey: string;
  children: ReactNode;
}) {
  // A fresh scope also invalidates popovers in cached views that resume later.
  const scope = useMemo(() => ({ active, navigationKey }), [active, navigationKey]);
  return <PopoverNavigationContext.Provider value={scope}>{children}</PopoverNavigationContext.Provider>;
}

export function useNavigationPopoverState() {
  const scope = useContext(PopoverNavigationContext);
  const [openedScope, setOpenedScope] = useState<typeof scope | null>(null);
  const setOpen = useCallback((open: boolean) => setOpenedScope(open ? scope : null), [scope]);
  return [scope.active && openedScope === scope, setOpen] as const;
}

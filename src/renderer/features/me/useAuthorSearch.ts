import { useEffect, useState } from 'react';
import type { MeApi } from '@/shared/contracts/me';
import { useAuthorUpdates } from '@/renderer/features/me/SpaceProfileProvider';

type Result = Awaited<ReturnType<MeApi['authors']>>;

export function useAuthorSearch(spaceId: string) {
  const [term, setTerm] = useState('');
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const updates = useAuthorUpdates();
  const key = JSON.stringify([spaceId, term, offset, retry, updates.revision]);
  const [state, setState] = useState<{ key: string; result?: Result; failed?: boolean }>();
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(
      () => {
        void window.desktopApi.me.authors({ spaceId, term, offset }).then(
          (result) => active && setState({ key, result }),
          () => active && setState({ key, failed: true }),
        );
      },
      term ? 180 : 0,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [key, spaceId, term, offset]);
  const current = state?.key === key ? state : undefined;
  return {
    term,
    offset,
    result: current?.result,
    failed: current?.failed ?? false,
    loading: !current,
    setTerm: (value: string) => {
      setTerm(value);
      setOffset(0);
    },
    setOffset,
    reload: () => {
      setOffset(0);
      setRetry((value) => value + 1);
    },
  };
}

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Author, CreationAuthorState, UserProfile } from '@/shared/contracts/me';

export type CreationAuthorChange = CreationAuthorState | Pick<Author, 'id' | 'name'>;
export type CreationAuthorChangeHandler = (spaceId: string, change: CreationAuthorChange) => void;

function useSpaceProfileState(spaceId: string | null, onAuthorChange: CreationAuthorChangeHandler) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [authorRevision, setAuthorRevision] = useState(0);
  const request = useRef(0);
  const savingRef = useRef(false);
  const lifetime = useRef(0);
  useEffect(() => {
    const current = ++lifetime.current;
    setProfile(null);
    setSaving(false);
    savingRef.current = false;
    return () => {
      lifetime.current = current + 1;
    };
  }, [spaceId]);
  useEffect(() => {
    const current = ++request.current;
    setFailed(false);
    if (!spaceId) return;
    void window.desktopApi.me.profile(spaceId).then(
      (value) => {
        if (request.current === current) setProfile(value);
      },
      () => {
        if (request.current === current) setFailed(true);
      },
    );
    return () => {
      request.current = current + 1;
    };
  }, [spaceId, revision]);

  async function save(draft: UserProfile) {
    if (!spaceId || !profile || savingRef.current) return false;
    const current = lifetime.current;
    savingRef.current = true;
    setSaving(true);
    try {
      const value = await window.desktopApi.me.saveProfile(spaceId, draft);
      if (lifetime.current !== current) return false;
      request.current++;
      setProfile(value);
      setAuthorRevision((value) => value + 1);
      if (value.id) onAuthorChange(spaceId, { id: value.id, name: value.authorName });
      return true;
    } catch (error) {
      if (lifetime.current === current) setRevision((value) => value + 1);
      throw error;
    } finally {
      if (lifetime.current === current) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  }
  const refreshAuthors = (change: CreationAuthorChange) => {
    if (spaceId) onAuthorChange(spaceId, change);
    setAuthorRevision((value) => value + 1);
    setRevision((value) => value + 1);
  };
  return {
    profile,
    failed,
    saving,
    save,
    authorRevision,
    refreshAuthors,
    retry: () => setRevision((value) => value + 1),
  };
}

const SpaceProfileContext = createContext<ReturnType<typeof useSpaceProfileState> | null>(null);

export function SpaceProfileProvider({
  spaceId,
  children,
  onAuthorChange,
}: {
  spaceId: string | null;
  children: ReactNode;
  onAuthorChange: CreationAuthorChangeHandler;
}) {
  const value = useSpaceProfileState(spaceId, onAuthorChange);
  return <SpaceProfileContext value={value}>{children}</SpaceProfileContext>;
}

export function useSpaceProfile() {
  const value = useContext(SpaceProfileContext);
  if (!value) throw new Error('SpaceProfileProvider is required');
  return value;
}

/** Static navigation previews also render the menu without a live space. */
export function useProfileSummary() {
  return useContext(SpaceProfileContext)?.profile ?? null;
}

const unchanged = () => undefined;
export function useAuthorUpdates() {
  const value = useContext(SpaceProfileContext);
  return { revision: value?.authorRevision ?? 0, changed: value?.refreshAuthors ?? unchanged };
}

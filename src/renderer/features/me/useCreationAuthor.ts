import { useEffect, useRef, useState } from 'react';
import type { CreationFormEntityRef } from '@/shared/contracts/creation-library';
import type { Author, AuthorFields, CreationAuthorState, MeApi } from '@/shared/contracts/me';
import { useAuthorUpdates } from '@/renderer/features/me/SpaceProfileProvider';

export function useCreationAuthor(spaceId: string, target: CreationFormEntityRef) {
  const { kind, id } = target;
  const [value, setValue] = useState<CreationAuthorState | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [pendingAssignment, setPendingAssignment] = useState<Parameters<MeApi['setCreationAuthor']>[0] | null>(null);
  const epoch = useRef(0),
    locked = useRef(false);
  const lifetime = useRef(0);
  useEffect(() => {
    const current = ++lifetime.current;
    setValue(null);
    setPendingAssignment(null);
    setSaving(false);
    locked.current = false;
    return () => {
      lifetime.current = current + 1;
    };
  }, [spaceId, kind, id]);
  const updates = useAuthorUpdates();
  useEffect(() => {
    const current = ++epoch.current;
    setLoading(true);
    setFailed(false);
    const api = window.desktopApi.me;
    if (!api?.creationAuthor) {
      setLoading(false);
      return;
    }
    void api.creationAuthor(spaceId, { kind, id }).then(
      (next) => {
        if (epoch.current === current) {
          setValue(next);
          setLoading(false);
        }
      },
      () => {
        if (epoch.current === current) {
          setFailed(true);
          setLoading(false);
        }
      },
    );
    return () => {
      epoch.current = current + 1;
    };
  }, [spaceId, kind, id, updates.revision, refresh]);

  async function mutate(action: () => Promise<CreationAuthorState | Author>) {
    if (locked.current) return false;
    locked.current = true;
    const current = lifetime.current;
    setSaving(true);
    try {
      const next = await action();
      if (lifetime.current !== current) return false;
      epoch.current++;
      setValue((previous) =>
        'target' in next
          ? next
          : previous
            ? { ...previous, authors: previous.authors.map((author) => (author.id === next.id ? next : author)) }
            : previous,
      );
      updates.changed(next);
      setRefresh((count) => count + 1);
      return true;
    } catch (error) {
      if (lifetime.current === current) setRefresh((count) => count + 1);
      throw error;
    } finally {
      if (lifetime.current === current) {
        locked.current = false;
        setSaving(false);
      }
    }
  }
  const submitAssignment = (input: Parameters<MeApi['setCreationAuthor']>[0]) =>
    mutate(async () => {
      const current = lifetime.current;
      try {
        const next = await window.desktopApi.me.setCreationAuthor(input);
        if (lifetime.current === current) setPendingAssignment(null);
        return next;
      } catch (error) {
        // Keep an uncertain creation request intact; its UUID also identifies the committed author.
        const rejected =
          /AUTHOR_(?:CHANGED|CANDIDATES_CHANGED|LIMIT|REQUEST_CONFLICT)|CREATION_UNAVAILABLE|ME_SPACE_CHANGED/.test(
            String(error),
          );
        if (lifetime.current === current)
          setPendingAssignment(input.selection.kind === 'NEW' && !rejected ? input : null);
        throw error;
      }
    });
  return {
    value,
    failed,
    loading,
    saving,
    pendingAssignment,
    retryAssignment: () => (pendingAssignment ? submitAssignment(pendingAssignment) : Promise.resolve(false)),
    retry: () => setRefresh((count) => count + 1),
    assign: (selection: Parameters<MeApi['setCreationAuthor']>[0]['selection']) =>
      value && !pendingAssignment
        ? submitAssignment({
            spaceId,
            target: value.target,
            expectedRevision: value.revision,
            selection,
          })
        : Promise.resolve(false),
    update: (author: Author, fields: AuthorFields) =>
      mutate(() =>
        window.desktopApi.me.updateAuthor({
          spaceId,
          authorId: author.id,
          expectedRevision: author.revision,
          fields,
        }),
      ),
  };
}

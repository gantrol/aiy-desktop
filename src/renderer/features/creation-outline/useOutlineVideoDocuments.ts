import { useEffect, useMemo, useRef, useState } from 'react';
import type { VideoDocumentSummaryDto } from '@/shared/contracts';
import {
  creationFormTitle,
  type CreationItemProjection,
  type CreationFormProjection,
  type CreationFormLabels,
} from '@/renderer/components/creator/creationLibraryProjection';

interface Snapshot {
  key: string;
  documents: Map<string, VideoDocumentSummaryDto>;
  failed: boolean;
}

/** Complete missing navigation summaries in pages, without an IPC request for every outline row. */
export function useOutlineVideoDocuments(
  creations: readonly CreationItemProjection[],
  labels: CreationFormLabels,
  active: boolean,
  revision: number,
) {
  const requestKey = useMemo(
    () =>
      JSON.stringify(
        creations
          .flatMap((item) =>
            item.orderedForms.flatMap((form) =>
              form.role === 'VIDEO_DOCUMENT' && !form.entity
                ? [{ id: form.entityRef.id, revision: item.item.updatedAt + ':' + revision }]
                : [],
            ),
          )
          .sort((left, right) => left.id.localeCompare(right.id)),
      ),
    [creations, revision],
  );
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const completedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!active || requestKey === '[]' || completedKey.current === requestKey) return;
    let current = true;
    const missing = new Set((JSON.parse(requestKey) as { id: string }[]).map((item) => item.id));
    const documents = new Map<string, VideoDocumentSummaryDto>();
    async function load() {
      try {
        let cursor: string | null = null;
        do {
          const page = await window.desktopApi.videoDocumentsList({
            query: '',
            albumId: null,
            unfiledOnly: false,
            cursor,
            limit: 100,
          });
          if (!current) return;
          for (const document of page.items) if (missing.delete(document.id)) documents.set(document.id, document);
          cursor = page.nextCursor;
        } while (cursor && missing.size);
        completedKey.current = requestKey;
        setSnapshot({ key: requestKey, documents, failed: missing.size > 0 });
      } catch {
        if (current) setSnapshot({ key: requestKey, documents, failed: true });
      }
    }
    void load();
    return () => {
      current = false;
    };
  }, [active, requestKey]);
  const matching = snapshot?.key === requestKey ? snapshot : null;
  const items = useMemo(() => {
    if (!matching?.documents.size) return creations;
    return creations.map((item) => {
      function resolve(form: CreationFormProjection | null): CreationFormProjection | null {
        if (form?.role !== 'VIDEO_DOCUMENT' || form.entity) return form;
        const entity = matching!.documents.get(form.entityRef.id);
        return entity ? { ...form, entity } : form;
      }
      const defaultForm = resolve(item.defaultForm);
      return {
        ...item,
        defaultForm,
        primaryForm: resolve(item.primaryForm),
        orderedForms: item.orderedForms.map((form) => resolve(form)!),
        title: defaultForm ? creationFormTitle(defaultForm, labels) : item.title,
      };
    });
  }, [creations, labels, matching]);
  return { items, loading: requestKey !== '[]' && !matching, failed: Boolean(matching?.failed) };
}

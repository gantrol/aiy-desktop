import { useCallback, useState } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { outlineExampleMarkdown } from '@/shared/outline-example-export';
import { initialWorks, topics } from './data';
import { downloadDraft } from './download';
import { workTitle } from './workTitle';
import type { Channel, EditorSession, Material, Work, WorkbenchError } from './types';

export function useWorkbench() {
  const copy = useI18n().messages.designLab.themeCreation;
  const [works, setWorks] = useState(initialWorks);
  const [topicId, setTopicId] = useState(topics[0].id);
  const [activeByTopic, setActiveByTopic] = useState<Record<string, string>>({
    loop: 'loop-outline',
    design: 'design-outline',
  });
  const [visited, setVisited] = useState(() => new Set(['loop-outline']));
  const [sessions, setSessions] = useState<Record<string, EditorSession>>({});
  const [error, setError] = useState<WorkbenchError | null>(null);
  const topic = topics.find((item) => item.id === topicId)!;
  const work = works.find((item) => item.id === activeByTopic[topicId])!;
  const session = sessions[work.id];
  const register = useCallback((id: string, value: EditorSession | null) => {
    setSessions((current) => {
      const next = { ...current };
      if (value) next[id] = value;
      else delete next[id];
      return next;
    });
  }, []);
  function select(id: string) {
    const next = works.find((item) => item.id === id);
    if (!next || session?.editor.isDestroyed || session?.editor.view.composing) return false;
    setTopicId(next.topicId);
    setActiveByTopic((current) => ({ ...current, [next.topicId]: id }));
    setVisited((current) => new Set([...current, id]));
    setError(null);
    return true;
  }
  function selectTopic(id: string) {
    return select(activeByTopic[id]);
  }
  function toggleInput(material: Material) {
    setWorks((current) =>
      current.map((item) =>
        item.id === work.id
          ? {
              ...item,
              inputs: item.inputs.some((input) => input.id === material.id)
                ? item.inputs.filter((input) => input.id !== material.id)
                : [...item.inputs, structuredClone(material)],
            }
          : item,
      ),
    );
  }
  function derive(channel?: Channel) {
    if (!session || session.editor.isDestroyed || session.editor.view.composing) return false;
    if (channel && work.channel) return false;
    const existing = channel && works.find((item) => item.source?.workId === work.id && item.channel === channel);
    if (existing) return select(existing.id);
    try {
      const captured = session.capture();
      const id = crypto.randomUUID();
      const next: Work = {
        id,
        topicId,
        title: work.title,
        document: structuredClone(captured.document),
        inputs: structuredClone(work.inputs),
        source: { workId: work.id, revision: captured.revision },
        ...(channel ? { channel } : {}),
      };
      setWorks((current) => [...current, next]);
      setActiveByTopic((current) => ({ ...current, [topicId]: id }));
      setVisited((current) => new Set([...current, id]));
      setError(null);
      return true;
    } catch {
      setError('failure');
      return false;
    }
  }
  function exportWork(format: 'md' | 'json') {
    if (!session || session.editor.isDestroyed || session.editor.view.composing) return;
    try {
      const snapshot = session.capture();
      const payload =
        format === 'md'
          ? outlineExampleMarkdown(snapshot.document)
          : JSON.stringify(
              {
                format: 'aiy.design-lab.minimal-loop',
                version: 1,
                productImportFormat: false,
                productBase: 'e9f3e7c362e1ed50ab29107483e75d833a327d69',
                work: { ...work, ...snapshot },
                permissions: { execute: false, publish: false, repositoryWrite: false },
              },
              null,
              2,
            );
      downloadDraft(
        payload,
        `${workTitle(work, copy)}.${format}`,
        format === 'md' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8',
      );
      setError(null);
    } catch {
      setError('failure');
    }
  }
  return {
    works,
    topic,
    work,
    visited,
    session,
    register,
    select,
    selectTopic,
    toggleInput,
    derive,
    exportWork,
    error,
    setError,
  };
}
export type WorkbenchModel = ReturnType<typeof useWorkbench>;

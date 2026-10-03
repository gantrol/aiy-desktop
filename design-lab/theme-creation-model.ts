import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  blankOutput,
  fixtures,
  identity,
  preparation,
  outputSource,
  findSource,
  type Kind,
  type Material,
  type Method,
  type Output,
  type Platform,
  type PlatformDraft,
  type Preparation,
  type Task,
  type Topic,
  type OutputLocation,
} from './theme-creation-types';

export function useThemeCreationModel() {
  const copy = useI18n().messages.designLab.themeCreation;
  const [data, setData] = useState(() => fixtures(copy));
  const [futureKind, setFutureKind] = useState<Kind>('article');
  const [notice, setNotice] = useState('');
  const [returnStack, setReturnStack] = useState<OutputLocation[]>([]);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    [],
  );
  const topic = data.topics.find((item) => item.id === data.activeId)!;
  const output = topic.outputs.find((item) => item.id === topic.activeId)!;
  const task = topic.tasks.find((item) => item.id === topic.viewingTask);
  const outputMaterials: Material[] = data.topics.flatMap((item) =>
    item.outputs.filter((work) => work.body.trim()).map((work) => outputSource(item, work)),
  );
  function updateTopic(id: string, update: (value: Topic) => Topic) {
    setData((current) => ({
      ...current,
      topics: current.topics.map((item) => (item.id === id ? update(item) : item)),
    }));
  }
  function updateOutput(topicId: string, id: string, update: (value: Output) => Output) {
    updateTopic(topicId, (item) => ({
      ...item,
      outputs: item.outputs.map((work) => (work.id === id ? update(work) : work)),
    }));
  }
  function editOutput(patch: Partial<Pick<Output, 'title' | 'body' | 'image'>>) {
    updateOutput(topic.id, output.id, (work) => ({ ...work, ...patch, revision: work.revision + 1 }));
  }
  function setPreparation(patch: Partial<Preparation>) {
    updateTopic(topic.id, (item) => ({ ...item, preparation: { ...item.preparation, ...patch } }));
  }
  function selectOutput(id: string) {
    updateTopic(topic.id, (item) => ({ ...item, activeId: id, viewingTask: null }));
  }
  function newOutput(kind = topic.defaultKind) {
    const work = blankOutput(kind, copy);
    updateTopic(topic.id, (item) => ({
      ...item,
      outputs: [...item.outputs, work],
      activeId: work.id,
      viewingTask: null,
    }));
  }
  function newTopic() {
    const work = blankOutput(futureKind, copy);
    const item: Topic = {
      id: identity(),
      title: copy.untitledTopic,
      defaultKind: futureKind,
      outputs: [work],
      activeId: work.id,
      preparation: preparation(futureKind),
      previous: [],
      tasks: [],
      viewingTask: null,
    };
    setData((current) => ({ ...current, topics: [...current.topics, item], activeId: item.id }));
  }
  function changeDefault(kind: Kind) {
    const title = blankOutput(kind, copy).title;
    updateTopic(topic.id, (item) => {
      const empty =
        item.outputs.length === 1 && !item.outputs[0].body && item.outputs[0].revision === 0 && !item.tasks.length;
      const untouchedPreparation =
        !item.preparation.inputs.length && !item.preparation.requirement && !item.preparation.targetId;
      return {
        ...item,
        defaultKind: kind,
        outputs: empty ? item.outputs.map((work) => ({ ...work, kind, title })) : item.outputs,
        preparation: untouchedPreparation ? { ...item.preparation, method: kind } : item.preparation,
      };
    });
  }
  function addInputs(materials: Material[]) {
    updateTopic(topic.id, (item) => ({
      ...item,
      preparation: {
        ...item.preparation,
        inputs: [...new Map([...item.preparation.inputs, ...materials].map((source) => [source.id, source])).values()],
      },
    }));
    setNotice(copy.inputsAdded);
  }
  function moveInput(id: string, direction: number) {
    const inputs = [...topic.preparation.inputs];
    const index = inputs.findIndex((item) => item.id === id);
    if (index < 0 || index + direction < 0 || index + direction >= inputs.length) return;
    [inputs[index], inputs[index + direction]] = [inputs[index + direction], inputs[index]];
    setPreparation({ inputs });
  }
  function prepareFromOutput(method: Method) {
    const source = outputSource(topic, output);
    updateTopic(topic.id, (item) => ({
      ...item,
      previous: [...item.previous, item.preparation].slice(-6),
      preparation: {
        ...preparation(method === 'rewrite' ? output.kind : method),
        method,
        inputs: [source],
        targetId: method === 'rewrite' ? output.id : null,
        baseRevision: method === 'rewrite' ? output.revision : null,
      },
    }));
    setNotice(copy.prepared);
  }
  function navigate(location: OutputLocation, remember = true) {
    const found = data.topics.find((item) => item.id === location.topicId);
    if (!found?.outputs.some((item) => item.id === location.outputId)) {
      setNotice(copy.sourceMissing);
      return;
    }
    if (remember) setReturnStack((items) => [...items, { topicId: topic.id, outputId: output.id }].slice(-12));
    setData((current) => ({
      ...current,
      activeId: location.topicId,
      topics: current.topics.map((item) =>
        item.id === location.topicId ? { ...item, activeId: location.outputId, viewingTask: null } : item,
      ),
    }));
  }
  function followSource(source: Material) {
    const found = findSource(data.topics, source);
    if (found) navigate({ topicId: found.topic.id, outputId: found.output.id });
    else setNotice(copy.sourceMissing);
  }
  function returnToWork() {
    const previous = returnStack.at(-1);
    if (!previous) return;
    navigate(previous, false);
    setReturnStack((items) => items.slice(0, -1));
  }
  function prepareFromSources() {
    const inputs = output.sources.map((source) => {
      const current = findSource(data.topics, source);
      return current ? outputSource(current.topic, current.output) : source;
    });
    if (!inputs.length) return;
    updateTopic(topic.id, (item) => ({
      ...item,
      previous: [...item.previous, item.preparation].slice(-6),
      preparation: { ...preparation(output.kind), inputs, targetId: output.id, baseRevision: output.revision },
    }));
    setNotice(copy.sourcePreserved);
  }
  function restorePreparation() {
    updateTopic(topic.id, (item) => ({
      ...item,
      preparation: item.previous.at(-1) ?? item.preparation,
      previous: item.previous.slice(0, -1),
    }));
  }
  function run() {
    if (topic.tasks.some((item) => item.status === 'running')) return;
    const frozen = structuredClone(topic.preparation);
    if (!frozen.inputs.length && !frozen.requirement.trim()) return;
    const target = topic.outputs.find((item) => item.id === frozen.targetId);
    if (frozen.method === 'rewrite' && !target) return;
    const kind: Kind = frozen.method === 'rewrite' ? target!.kind : frozen.method;
    const sources = frozen.inputs.map((item) => item.body).filter(Boolean);
    const body =
      kind === 'outline'
        ? frozen.inputs.map((item, index) => `${index + 1}. ${item.title}\n   ${item.body}`).join('\n\n') ||
          frozen.requirement
        : frozen.method === 'rewrite'
          ? `${sources.join('\n\n')}\n\n${copy.rewrittenEnding}`
          : `${copy.generatedIntro}\n\n${sources.join('\n\n')}\n\n${frozen.requirement || copy.generatedEnd}`;
    const next: Task = {
      id: identity(),
      status: 'running',
      preparation: frozen,
      kind,
      title: kind === 'outline' ? copy.seedOutlineTitle : kind === 'image' ? copy.seedCoverTitle : copy.generatedTitle,
      body,
      image: 0,
    };
    const owner = topic.id;
    updateTopic(owner, (item) => ({ ...item, tasks: [...item.tasks, next], viewingTask: next.id }));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      updateTopic(owner, (item) => ({
        ...item,
        tasks: item.tasks.map((job) =>
          job.id === next.id && job.status === 'running' ? { ...job, status: 'ready' } : job,
        ),
      }));
    }, 1600);
    timers.current.add(timer);
  }
  function adopt(separate: boolean) {
    if (!task || task.status !== 'ready') return;
    updateTopic(topic.id, (item) => {
      const job = item.tasks.find((entry) => entry.id === task.id);
      if (!job || job.status !== 'ready') return item;
      const target = item.outputs.find((work) => work.id === job.preparation.targetId);
      if (!separate && job.preparation.targetId && (!target || target.revision !== job.preparation.baseRevision))
        return item;
      const work: Output =
        target && !separate
          ? {
              ...target,
              body: job.body,
              image: job.image,
              revision: target.revision + 1,
              sources: job.preparation.method === 'rewrite' ? target.sources : job.preparation.inputs,
              versions: [...target.versions, { title: target.title, body: target.body, image: target.image }],
            }
          : {
              ...blankOutput(job.kind, copy),
              title: job.title,
              body: job.body,
              image: job.image,
              sources: job.preparation.inputs,
            };
      return {
        ...item,
        outputs:
          target && !separate
            ? item.outputs.map((entry) => (entry.id === target.id ? work : entry))
            : [...item.outputs, work],
        activeId: work.id,
        viewingTask: null,
        tasks: item.tasks.map((entry) => (entry.id === job.id ? { ...entry, status: 'adopted' } : entry)),
      };
    });
  }
  function patchTask(patch: Partial<Pick<Task, 'body' | 'title' | 'image'>>) {
    updateTopic(topic.id, (item) => ({
      ...item,
      tasks: item.tasks.map((job) => (job.id === task?.id ? { ...job, ...patch } : job)),
    }));
  }
  function cancelTask(id: string) {
    updateTopic(topic.id, (item) => ({
      ...item,
      viewingTask: item.viewingTask === id ? null : item.viewingTask,
      tasks: item.tasks.map((job) => (job.id === id ? { ...job, status: 'cancelled' } : job)),
    }));
  }
  function saveVersion() {
    updateOutput(topic.id, output.id, (work) => ({
      ...work,
      versions: [...work.versions, { title: work.title, body: work.body, image: work.image }],
    }));
    setNotice(copy.versionSaved);
  }
  function platformDraft(platform: Platform): PlatformDraft {
    return (
      output.platforms[platform] ?? {
        title: output.title,
        body: output.body,
        sourceRevision: output.revision,
        sent: false,
      }
    );
  }
  function editPlatform(platform: Platform, patch: Partial<PlatformDraft>) {
    const base = platformDraft(platform);
    updateOutput(topic.id, output.id, (work) => ({
      ...work,
      platforms: { ...work.platforms, [platform]: { ...base, ...patch } },
    }));
  }
  function reset() {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
    setData(fixtures(copy));
    setFutureKind('article');
    setNotice('');
    setReturnStack([]);
  }
  return {
    copy,
    data,
    topic,
    output,
    task,
    notice,
    materials: [...data.materials, ...outputMaterials],
    futureKind,
    currentSource: outputSource(topic, output),
    returnTarget: returnStack.at(-1),
    navigate,
    followSource,
    returnToWork,
    prepareFromSources,
    editOutput,
    setPreparation,
    selectOutput,
    newOutput,
    newTopic,
    changeDefault,
    addInputs,
    moveInput,
    prepareFromOutput,
    restorePreparation,
    run,
    adopt,
    patchTask,
    cancelTask,
    saveVersion,
    platformDraft,
    editPlatform,
    reset,
    selectTopic: (id: string) => setData((current) => ({ ...current, activeId: id })),
    renameTopic: (title: string) => updateTopic(topic.id, (item) => ({ ...item, title })),
    viewTask: (id: string | null) => updateTopic(topic.id, (item) => ({ ...item, viewingTask: id })),
    setFutureDefault: () => {
      setFutureKind(topic.defaultKind);
      setNotice(copy.futureDefaultSaved);
    },
  };
}
export type ThemeModel = ReturnType<typeof useThemeCreationModel>;

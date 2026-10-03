import type { MessageCatalog } from '@/renderer/i18n/catalog';

export type Copy = MessageCatalog['designLab']['themeCreation'];
export type Kind = 'article' | 'outline' | 'image';
export type Method = Kind | 'rewrite';
export interface Material {
  id: string;
  kind: 'comments' | 'notes' | 'images' | 'outputs';
  title: string;
  body: string;
  outputId?: string;
  topicId?: string;
  outputRevision?: number;
  image?: number;
}
export interface PlatformDraft {
  title: string;
  body: string;
  sourceRevision: number;
  sent: boolean;
}
export interface Output {
  id: string;
  kind: Kind;
  title: string;
  body: string;
  revision: number;
  image: number;
  sources: Material[];
  versions: { title: string; body: string; image: number }[];
  platforms: Partial<Record<Platform, PlatformDraft>>;
}
export type Platform = 'wechat' | 'rednote';
export interface Preparation {
  method: Method;
  inputs: Material[];
  requirement: string;
  tone: 'natural' | 'concise';
  targetId: string | null;
  baseRevision: number | null;
}
export interface Task {
  id: string;
  status: 'running' | 'ready' | 'adopted' | 'cancelled';
  preparation: Preparation;
  kind: Kind;
  title: string;
  body: string;
  image: number;
}
export interface Topic {
  id: string;
  title: string;
  defaultKind: Kind;
  outputs: Output[];
  activeId: string;
  preparation: Preparation;
  previous: Preparation[];
  tasks: Task[];
  viewingTask: string | null;
}
export interface OutputLocation {
  topicId: string;
  outputId: string;
}
export function outputSource(topic: Topic, output: Output): Material {
  return {
    id: `${output.id}:${output.revision}`,
    kind: 'outputs',
    topicId: topic.id,
    outputId: output.id,
    outputRevision: output.revision,
    title: output.title,
    body: output.body,
    ...(output.kind === 'image' ? { image: output.image } : {}),
  };
}
export function findSource(topics: Topic[], source: Material) {
  if (!source.outputId) return undefined;
  for (const topic of topics) {
    if (source.topicId && source.topicId !== topic.id) continue;
    const output = topic.outputs.find((item) => item.id === source.outputId);
    if (output) return { topic, output };
  }
  return undefined;
}
export const kinds: Kind[] = ['article', 'outline', 'image'];
let sequence = 0;
export const identity = () => `demo-${++sequence}`;
export const preparation = (kind: Kind): Preparation => ({
  method: kind,
  inputs: [],
  requirement: '',
  tone: 'natural',
  targetId: null,
  baseRevision: null,
});
export function blankOutput(kind: Kind, copy: Copy): Output {
  const titles = { article: copy.blankArticle, outline: copy.blankOutline, image: copy.blankImage };
  return {
    id: identity(),
    kind,
    title: titles[kind],
    body: '',
    revision: 0,
    image: 0,
    sources: [],
    versions: [],
    platforms: {},
  };
}
export function fixtures(copy: Copy) {
  const materials: Material[] = [
    { id: 'comment-one', kind: 'comments', title: copy.commentOneTitle, body: copy.commentOne },
    { id: 'comment-two', kind: 'comments', title: copy.commentTwoTitle, body: copy.commentTwo },
    { id: 'reading-note', kind: 'notes', title: copy.noteTitle, body: copy.noteBody },
    { id: 'reference-image', kind: 'images', title: copy.imageTitle, body: copy.imageBody, image: 0 },
  ];
  const outline = {
    ...blankOutput('outline', copy),
    title: copy.seedOutlineTitle,
    body: copy.seedOutline,
    sources: materials.slice(0, 2),
  };
  const article = {
    ...blankOutput('article', copy),
    title: copy.seedArticleTitle,
    body: copy.seedArticle,
    sources: materials.slice(0, 2),
  };
  const cover = { ...blankOutput('image', copy), title: copy.seedCoverTitle, body: copy.readTopic };
  const walk = { ...blankOutput('article', copy), title: copy.travelTopic, body: copy.travelBody };
  const topic = (title: string, outputs: Output[], activeId: string): Topic => ({
    id: identity(),
    title,
    outputs,
    activeId,
    defaultKind: 'article',
    preparation: preparation('article'),
    previous: [],
    tasks: [],
    viewingTask: null,
  });
  const reading = topic(copy.readTopic, [outline, article, cover], article.id);
  article.sources = [outputSource(reading, outline)];
  reading.outputs[2].sources = [outputSource(reading, article)];
  reading.preparation.inputs = materials.slice(0, 2);
  return { materials, topics: [reading, topic(copy.travelTopic, [walk], walk.id)], activeId: reading.id };
}

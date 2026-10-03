import type { Editor } from '@tiptap/core';
import type { BlockDocument } from '@/shared/contracts/block-document';

export type Panel = 'topics' | 'inputs' | 'outputs';
export type Channel = 'wechat' | 'rednote';
export type WorkbenchError = 'failure' | 'locationMissing';
export interface Material {
  id: string;
  title: string;
  body: string;
}
export interface Work {
  id: string;
  topicId: string;
  title: string;
  document: BlockDocument;
  inputs: Material[];
  source?: { workId: string; revision: number };
  channel?: Channel;
}
export interface Topic {
  id: string;
  title: string;
  materials: Material[];
}
export interface EditorSession {
  editor: Editor;
  capture(): { document: BlockDocument; revision: number };
}

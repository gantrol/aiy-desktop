import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { Node, mergeAttributes, type JSONContent } from '@tiptap/core';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { useState } from 'react';
import './contentRevealExtension.css';

export type RevealKind = 'REVEAL' | 'IMAGE_SWAP';

function RevealNodeView({ node, editor, getPos }: NodeViewProps) {
  const copy = useI18n().messages.videoDocuments.editor.richText;
  const [preview, setPreview] = useState<'edit' | 'initial' | 'answer'>('edit');

  function convertToContent() {
    const position = getPos();
    if (typeof position !== 'number' || !editor.isEditable) return;
    const current = editor.state.doc.nodeAt(position);
    if (current?.type.name !== 'reveal') return;
    const content = current.content.content.flatMap((stage) => stage.content.toJSON() as JSONContent[]);
    editor
      .chain()
      .focus()
      .insertContentAt({ from: position, to: position + current.nodeSize }, content)
      .run();
  }

  return (
    <NodeViewWrapper
      data-aiy-reveal
      data-preview-state={preview}
      className="aiy-reveal my-4 min-w-0 border-l-2 border-border pl-3"
    >
      <div contentEditable={false} className="mb-2 flex flex-wrap items-center gap-1">
        <span className="mr-auto text-xs font-medium text-muted-foreground">
          {node.attrs.kind === 'IMAGE_SWAP' ? copy.imageSwap : copy.clickReveal}
        </span>
        <Button
          type="button"
          size="sm"
          variant={preview === 'edit' ? 'secondary' : 'ghost'}
          onClick={() => setPreview('edit')}
        >
          {copy.editInteraction}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={preview !== 'edit' ? 'secondary' : 'ghost'}
          onClick={() => {
            editor.commands.blur();
            setPreview('initial');
          }}
        >
          {copy.previewInteraction}
        </Button>
        {preview !== 'edit' && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setPreview((current) => (current === 'initial' ? 'answer' : 'initial'))}
          >
            {preview === 'initial' ? copy.showReveal : copy.resetReveal}
          </Button>
        )}
        {editor.isEditable && (
          <Button type="button" size="sm" variant="ghost" onClick={convertToContent}>
            {copy.flattenInteraction}
          </Button>
        )}
      </div>
      <NodeViewContent className={cn('min-w-0', preview !== 'edit' && 'select-none')} />
    </NodeViewWrapper>
  );
}

function RevealStageView({ node }: NodeViewProps) {
  const copy = useI18n().messages.videoDocuments.editor.richText;
  const initial = node.type.name === 'revealInitial';
  return (
    <NodeViewWrapper data-aiy-reveal-stage={initial ? 'initial' : 'answer'} className="min-w-0 py-1">
      <div contentEditable={false} className="text-xs text-muted-foreground">
        {initial ? copy.initialState : copy.revealedState}
      </div>
      <NodeViewContent className="min-w-0" />
    </NodeViewWrapper>
  );
}

export const ContentReveal = Node.create({
  name: 'reveal',
  group: 'block',
  content: 'revealInitial revealAnswer',
  defining: true,
  isolating: true,
  addAttributes: () => ({
    kind: {
      default: 'REVEAL',
      parseHTML: (element) => (element.getAttribute('data-aiy-reveal') === 'IMAGE_SWAP' ? 'IMAGE_SWAP' : 'REVEAL'),
      renderHTML: (attrs) => ({ 'data-aiy-reveal': attrs.kind }),
    },
  }),
  parseHTML: () => [{ tag: 'div[data-aiy-reveal]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes), 0],
  renderMarkdown: (node, helpers) =>
    helpers.renderChildren(
      (node.content ?? []).flatMap((stage) => stage.content ?? []),
      '\n\n',
    ),
  addNodeView: () => ReactNodeViewRenderer(RevealNodeView),
});

function revealStage(name: 'revealInitial' | 'revealAnswer', stage: 'initial' | 'answer') {
  return Node.create({
    name,
    content: 'block+',
    defining: true,
    selectable: false,
    parseHTML: () => [{ tag: `div[data-aiy-reveal-stage="${stage}"]` }],
    renderHTML: () => ['div', { 'data-aiy-reveal-stage': stage }, 0],
    renderMarkdown: (node, helpers) => helpers.renderChildren(node.content ?? [], '\n\n'),
    addNodeView: () => ReactNodeViewRenderer(RevealStageView),
  });
}

export const ContentRevealInitial = revealStage('revealInitial', 'initial');
export const ContentRevealAnswer = revealStage('revealAnswer', 'answer');

export function insertRevealBlock(
  editor: import('@tiptap/core').Editor,
  kind: RevealKind,
  captions: { initial: string; answer: string },
) {
  const paragraph = (value: string): JSONContent => ({
    type: 'paragraph',
    content: [{ type: 'text', text: value }],
  });
  return editor
    .chain()
    .focus()
    .insertContent({
      type: 'reveal',
      attrs: { kind },
      content: [
        { type: 'revealInitial', content: [paragraph(captions.initial)] },
        { type: 'revealAnswer', content: [paragraph(captions.answer)] },
      ],
    })
    .run();
}

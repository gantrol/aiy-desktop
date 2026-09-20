import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, useEditorState, type NodeViewProps } from '@tiptap/react';
import { useEffect, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { contentReferenceToken, type ContentReference } from '@/shared/contracts/content-library';
import { ContentReferencePicker, contentLibraryApi } from '@/renderer/features/content-editor/ContentReferencePicker';
import { ContentReferenceSource } from '@/renderer/features/content-editor/ContentReferenceSource';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { ContentReferenceBody } from '@/renderer/features/content-editor/ContentReferenceBody';
import { ContentReferenceViewport } from '@/renderer/features/content-editor/ContentReferenceViewport';
import { ContentReferenceScope } from '@/renderer/features/content-editor/ContentReferenceScope';
import { useContentReferenceHost } from '@/renderer/features/content-editor/ContentReferenceHost';
import { copyContentReference } from '@/renderer/features/content-editor/contentReferenceClipboard';
import { isDocumentSource } from '@/shared/contracts/content-source';
import { referenceFailure } from '@/shared/i18n/reference-outline';

function ReferenceNode({ node, editor, getPos, updateAttributes, extension }: NodeViewProps) {
  const { messages } = useI18n();
  const copy = messages.desktopPetals.document,
    labels = messages.referenceOutline;
  const host = useContentReferenceHost();
  const [reference, setReference] = useState<ContentReference | null>(null);
  const [error, setError] = useState('');
  const id = String(node.attrs.referenceId);
  const editable = useEditorState({ editor, selector: ({ editor: current }) => current.isEditable });
  useEffect(() => {
    let live = true;
    setReference(null);
    setError('');
    void contentLibraryApi()
      .references([id])
      .then((rows) => {
        if (live) {
          setReference(rows[0] ?? null);
          if (!rows.length) setError(copy.unavailable);
        }
      })
      .catch(() => {
        if (live) setError(copy.unavailable);
      });
    return () => {
      live = false;
    };
  }, [id, copy.unavailable]);
  const adopt = extension.options.adopt as (reference: ContentReference) => void;
  const currentPosition = () => {
    if (editor.isDestroyed || !editor.isEditable || editor.view.composing) throw new Error('REFERENCE_TARGET_CHANGED');
    const position = getPos();
    if (position === undefined || editor.state.doc.nodeAt(position)?.attrs.referenceId !== id)
      throw new Error('REFERENCE_TARGET_CHANGED');
    return position;
  };
  return (
    <NodeViewWrapper
      data-content-reference
      className="my-3 min-w-0 border-l-2 border-muted-foreground/35 pl-3"
      contentEditable={false}
    >
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{reference?.title || copy.reference}</span>
        <span title={reference?.revisionId}>{copy.fixed}</span>
        {reference && (
          <>
            {editable && (
              <>
                <ContentReferencePicker
                  source={reference.source}
                  label={copy.update}
                  blockId={reference.selector?.kind === 'BLOCK' ? reference.selector.blockId : undefined}
                  section={reference.selector?.kind === 'BLOCK' ? reference.selector.section : undefined}
                  scope={reference.selector?.kind === 'BLOCK' ? reference.selector.scope : undefined}
                  onInsert={(next) => {
                    currentPosition();
                    updateAttributes({ referenceId: next.id });
                  }}
                />
                {host.outline && (
                  <ContentReferenceScope
                    reference={reference}
                    onChange={(next) => {
                      currentPosition();
                      updateAttributes({ referenceId: next.id });
                    }}
                  />
                )}
              </>
            )}
            <ContentReferenceSource
              key={reference.id}
              reference={reference}
              originBlockId={String(node.attrs.blockId ?? '')}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label={messages.contentEditor.blocks}>
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  onSelect={() =>
                    void copyContentReference(reference)
                      .then(() => setError(''))
                      .catch((reason) => setError(referenceFailure(reason, labels, labels.clipboardFailed)))
                  }
                >
                  {labels.copyReference}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    void copyContentReference(reference, 'TEXT')
                      .then(() => setError(''))
                      .catch((reason) => setError(referenceFailure(reason, labels, labels.clipboardFailed)))
                  }
                >
                  {labels.copyText}
                </DropdownMenuItem>
                {editable && (
                  <DropdownMenuItem
                    onSelect={() => {
                      try {
                        const position = currentPosition();
                        adopt(reference);
                        editor
                          .chain()
                          .focus()
                          .insertContentAt({ from: position, to: position + node.nodeSize }, reference.markdown, {
                            contentType: 'markdown',
                          })
                          .run();
                      } catch {
                        setError(labels.failure);
                      }
                    }}
                  >
                    {labels.convert}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
      {reference && (
        <ContentReferenceViewport
          key={`${host.source?.id ?? 'local'}:${node.attrs.blockId || id}`}
          storageKey={`aiy-reference-height:v1:${host.source?.kind ?? ''}:${host.source?.id ?? 'local'}:${node.attrs.blockId || id}`}
        >
          <ContentReferenceBody
            key={reference.id}
            originBlockId={String(node.attrs.blockId ?? '')}
            markdown={reference.markdown}
            media={reference.media}
            source={{
              ...reference.source,
              ...(isDocumentSource(reference.source) ? { revisionId: reference.revisionId } : {}),
            }}
          />
        </ContentReferenceViewport>
      )}
    </NodeViewWrapper>
  );
}
export function contentReferenceExtension(adopt: (reference: ContentReference) => void) {
  return Node.create({
    name: 'contentReference',
    group: 'block',
    atom: true,
    draggable: true,
    addOptions: () => ({ adopt }),
    addAttributes: () => ({ referenceId: { default: '' } }),
    parseHTML: () => [
      {
        tag: 'div[data-aiy-reference]',
        getAttrs: (element) => ({ referenceId: element.getAttribute('data-aiy-reference') }),
      },
    ],
    renderHTML: ({ node, HTMLAttributes }) => [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-aiy-reference': node.attrs.referenceId }),
      contentReferenceToken(String(node.attrs.referenceId)),
    ],
    markdownTokenName: 'aiyBlockReference',
    markdownTokenizer: {
      name: 'aiyBlockReference',
      level: 'block',
      start: ':::aiy-block ',
      tokenize: (source) => {
        const match = /^:::aiy-block ([A-Za-z0-9_-]{1,200})\r?\n:::[ \t]*(?:\r?\n|$)/u.exec(source);
        return match ? { type: 'aiyBlockReference', raw: match[0], referenceId: match[1] } : undefined;
      },
    },
    parseMarkdown: (token, helpers) => helpers.createNode('contentReference', { referenceId: token.referenceId }),
    renderMarkdown: (node) => contentReferenceToken(String(node.attrs?.referenceId)),
    addNodeView: () => ReactNodeViewRenderer(ReferenceNode),
  });
}

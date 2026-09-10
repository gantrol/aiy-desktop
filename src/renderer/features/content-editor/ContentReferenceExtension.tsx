import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, useEditorState, type NodeViewProps } from '@tiptap/react';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { contentReferenceToken, type ContentReference } from '@/shared/contracts/content-library';
import { ContentReferencePicker, contentLibraryApi } from '@/renderer/features/content-editor/ContentReferencePicker';
import { ContentReferenceSource } from '@/renderer/features/content-editor/ContentReferenceSource';

function ReferenceNode({ node, editor, getPos, updateAttributes, extension }: NodeViewProps) {
  const copy = useI18n().messages.desktopPetals.document;
  const [reference, setReference] = useState<ContentReference | null>(null),
    [error, setError] = useState('');
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
  return (
    <NodeViewWrapper className="my-3 border-l-2 border-muted-foreground/35 pl-3" contentEditable={false}>
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
                  onInsert={(next) => {
                    if (!editor.isEditable) return;
                    adopt(next);
                    updateAttributes({ referenceId: next.id });
                  }}
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title={copy.copy}
                  aria-label={copy.copy}
                  onClick={() => {
                    const position = getPos();
                    if (position === undefined || !editor.isEditable) return;
                    adopt(reference);
                    editor
                      .chain()
                      .focus()
                      .insertContentAt({ from: position, to: position + node.nodeSize }, reference.markdown, {
                        contentType: 'markdown',
                      })
                      .run();
                  }}
                >
                  <Copy className="size-3.5" />
                </Button>
              </>
            )}
            <ContentReferenceSource reference={reference} />
          </>
        )}
      </div>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : (
        reference && (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            urlTransform={(url) =>
              reference.media.find((media) => media.path === url)?.mediaUrl ?? (/^https?:\/\//u.test(url) ? url : '')
            }
          >
            {reference.markdown}
          </ReactMarkdown>
        )
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

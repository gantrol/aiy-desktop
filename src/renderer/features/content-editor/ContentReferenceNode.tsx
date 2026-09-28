import { useEffect, useState } from 'react';
import { NodeViewWrapper, useEditorState, type NodeViewProps } from '@tiptap/react';
import { ChevronRight, Link } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useArticleEditorSessions } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { ContentReferenceBody } from '@/renderer/features/content-editor/ContentReferenceBody';
import { ContentReferenceToolbar } from '@/renderer/features/content-editor/ContentReferenceToolbar';
import { ContentReferenceViewport } from '@/renderer/features/content-editor/ContentReferenceViewport';
import { FollowingReferenceEditor } from '@/renderer/features/content-editor/FollowingReferenceEditor';
import { FollowingReferenceBody } from '@/renderer/features/content-editor/FollowingReferenceBody';
import { useContentReferenceHost } from '@/renderer/features/content-editor/ContentReferenceHost';
import { useReferenceCollapsePreference } from '@/renderer/features/content-editor/useReferenceCollapsePreference';
import { observeContentReference } from '@/renderer/features/content-editor/followingReferenceRefresh';
import { referenceParentHeading } from '@/renderer/features/content-editor/referenceParentHeading';
import { referenceToolbarState } from '@/renderer/features/content-editor/referenceToolbarState';
import { useReferenceNavigation } from '@/renderer/features/content-editor/contentReferenceNavigation';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { currentReferenceTarget } from '@/renderer/features/content-editor/ContentReferencePicker';
import type { ContentReference, ResolvedContentReference } from '@/shared/contracts/content-library';
import {
  referenceEditingAttribute,
  referencePresentationAttribute,
  type ReferencePresentation,
} from '@/shared/content-reference-token';
import { presentReferenceMarkdown } from '@/shared/content-reference-presentation';
import { presentReferenceDocument } from '@/shared/content-reference-document';
import { referenceLinkUrl } from '@/shared/content-reference-link';
import { isDocumentSource } from '@/shared/contracts/content-source';
import { referenceFailure } from '@/shared/i18n/reference-outline';

function useReferenceNodeState(props: NodeViewProps) {
  const { node, editor, getPos } = props;
  const { messages } = useI18n();
  const copy = messages.desktopPetals.document,
    labels = messages.referenceOutline;
  const host = useContentReferenceHost();
  const sessions = useArticleEditorSessions();
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useReferenceCollapsePreference(
    host.source,
    node.attrs.referenceSpaceId ?? null,
    String(node.attrs.blockId ?? ''),
  );
  const id = String(node.attrs.referenceId);
  const observed = useReferenceResolution(id, node.attrs.referenceSpaceId);
  const resolution = observed.resolution;
  const presentation = referencePresentationAttribute(node.attrs.referencePresentation);
  const editing = referenceEditingAttribute(node.attrs.referenceEditing);
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      editable: current.isEditable,
      inserted: referenceToolbarState.getState(current.state)?.includes(String(node.attrs.blockId)) ?? false,
      parentLevel: referenceParentHeading(current.state.doc, getPos() ?? -1),
    }),
  });
  const reference = resolution?.reference;
  const link = presentation?.display === 'LINK';
  const shared =
    Boolean(sessions) &&
    !host.sharedEditor &&
    resolution?.mode === 'FOLLOW' &&
    resolution.state === 'CURRENT' &&
    reference?.source.kind === 'ARTICLE';
  const writable = shared && state.editable && editing === 'SOURCE';
  const collapse = async (open: boolean) => {
    try {
      const session = reference?.spaceId ? sessions?.find(reference.spaceId, reference.source.id) : undefined;
      if (writable && session && !(await session.flush('manual'))) throw new Error('REFERENCE_SAVE_FAILED');
      if (!editor.isDestroyed && editor.state.doc.nodeAt(getPos() ?? -1)?.attrs.referenceId === id) setCollapsed(!open);
    } catch (reason) {
      setError(referenceFailure(reason, labels));
    }
  };
  return {
    copy,
    labels,
    state,
    reference,
    resolution,
    observed,
    error,
    collapsed,
    collapse,
    presentation,
    editing,
    shared,
    writable,
    link,
  };
}

export function ContentReferenceNode(props: NodeViewProps) {
  const { node, extension, selected } = props;
  const {
    copy,
    labels,
    state,
    reference,
    resolution,
    observed,
    error,
    collapsed,
    collapse,
    presentation,
    editing,
    shared,
    writable,
    link,
  } = useReferenceNodeState(props);
  const originBlockId = String(node.attrs.blockId ?? '');
  return (
    <NodeViewWrapper
      data-content-reference
      data-reference-collapsed={collapsed}
      data-reference-editing={writable}
      className={`group/reference relative my-3 min-w-0 data-[reference-editing=true]:border-l-2 data-[reference-editing=true]:border-muted-foreground/50 data-[reference-editing=true]:pl-3 ${!link && presentation?.display !== 'BODY' ? 'border-l-2 border-muted-foreground/35 pl-3' : ''}`}
      contentEditable={false}
    >
      <Collapsible open={!collapsed} onOpenChange={(open) => void collapse(open)}>
        <div className="sticky top-0 z-10 flex min-h-7 flex-wrap items-center gap-1 bg-background text-xs text-muted-foreground">
          {!link && (
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                data-reference-expand
                aria-label={collapsed ? labels.expand : labels.collapse}
              >
                <ChevronRight className={collapsed ? 'size-3.5' : 'size-3.5 rotate-90'} />
              </Button>
            </CollapsibleTrigger>
          )}
          {link && reference ? (
            <ReferenceLink reference={reference} originBlockId={originBlockId} />
          ) : (
            <span className="min-w-0 flex-1 truncate" title={reference?.title}>
              {reference?.title || copy.reference}
            </span>
          )}
          {reference && resolution && (
            <ContentReferenceToolbar
              key={reference.id}
              {...props}
              reference={reference}
              resolution={resolution}
              presentation={presentation}
              editing={editing}
              editable={state.editable}
              visible={state.inserted || selected || writable}
              adopt={extension.options.adopt as (value: ContentReference) => void}
            />
          )}
        </div>
        {resolution?.state === 'UNAVAILABLE' && (
          <span role="status" className="text-xs text-warning">
            {resolution.reason === 'REFERENCE_FOLLOW_NESTED' ? labels.followNested : labels.followUnavailable}
          </span>
        )}
        {(error || observed.error) && (
          <span role="alert" className="text-xs text-destructive">
            {error || observed.error}
          </span>
        )}
        {!link && reference && (
          <CollapsibleContent>
            <ReferenceFrame reference={reference} presentation={presentation} originBlockId={originBlockId}>
              {shared ? (
                writable ? (
                  <FollowingReferenceEditor
                    reference={reference}
                    presentation={presentation}
                    parentLevel={state.parentLevel}
                  />
                ) : (
                  <FollowingReferenceBody
                    reference={reference}
                    presentation={presentation}
                    parentLevel={state.parentLevel}
                    originBlockId={originBlockId}
                  />
                )
              ) : (
                <CapturedContents
                  reference={reference}
                  presentation={presentation}
                  parentLevel={state.parentLevel}
                  originBlockId={originBlockId}
                />
              )}
            </ReferenceFrame>
          </CollapsibleContent>
        )}
      </Collapsible>
    </NodeViewWrapper>
  );
}

function useReferenceResolution(id: string, spaceId: string | null) {
  const { messages } = useI18n();
  const unavailable = messages.desktopPetals.document.unavailable;
  const followUnavailable = messages.referenceOutline.followUnavailable;
  const [state, setState] = useState<{ id: string; resolution: ResolvedContentReference | null; error: string }>({
    id,
    resolution: null,
    error: '',
  });
  useEffect(
    () =>
      observeContentReference(id, {
        changed: (row) => {
          if (row && spaceId && row.reference.spaceId !== spaceId) {
            setState({ id, resolution: null, error: followUnavailable });
            return;
          }
          setState({ id, resolution: row ?? null, error: row ? '' : unavailable });
        },
        failed: () => setState((current) => ({ ...current, error: unavailable })),
      }),
    [id, spaceId, unavailable, followUnavailable],
  );
  return state.id === id ? state : { resolution: null, error: '' };
}

function ReferenceFrame({
  reference,
  presentation,
  originBlockId,
  children,
}: {
  reference: ContentReference;
  presentation?: ReferencePresentation;
  originBlockId: string;
  children: React.ReactNode;
}) {
  const host = useContentReferenceHost();
  if (presentation?.display === 'BODY') return children;
  return (
    <ContentReferenceViewport
      storageKey={`aiy-reference-height:v1:${host.source?.kind ?? ''}:${host.source?.id ?? 'local'}:${originBlockId || reference.id}`}
    >
      {children}
    </ContentReferenceViewport>
  );
}

function CapturedContents({
  reference,
  presentation,
  parentLevel,
  originBlockId,
}: {
  reference: ContentReference;
  presentation?: ReferencePresentation;
  parentLevel: number;
  originBlockId: string;
}) {
  const host = useContentReferenceHost();
  const copy = useI18n().messages.referenceOutline;
  try {
    const value = presentation ? { ...presentation, display: 'BODY' as const } : undefined;
    return (
      <ContentReferenceBody
        originBlockId={originBlockId}
        markdown={presentReferenceMarkdown(reference, value, parentLevel)}
        document={reference.document ? presentReferenceDocument(reference, value, parentLevel) : undefined}
        typography={presentation?.display === 'BODY' && !host.outline ? 'article' : 'compact'}
        media={reference.media}
        source={{
          ...reference.source,
          ...(isDocumentSource(reference.source) ? { revisionId: reference.revisionId } : {}),
        }}
      />
    );
  } catch (reason) {
    return <span role="alert">{referenceFailure(reason, copy)}</span>;
  }
}

function ReferenceLink({ reference, originBlockId }: { reference: ContentReference; originBlockId: string }) {
  const navigate = useReferenceNavigation(originBlockId);
  const copy = useI18n().messages.referenceOutline;
  const [error, setError] = useState('');
  const href = referenceLinkUrl(reference);
  const open = async () => {
    try {
      const selector = reference.selector?.kind === 'BLOCK' ? reference.selector : undefined;
      if (reference.source.kind === 'ALBUM' && href) await contentLibraryApi().linkOpen(href);
      else
        await navigate(currentReferenceTarget(reference.source, selector?.blockId, selector?.section, selector?.scope));
      setError('');
    } catch (reason) {
      setError(referenceFailure(reason, copy));
    }
  };
  return (
    <div className="min-w-0 flex-1">
      <Button
        asChild
        variant="link"
        size="sm"
        className="h-auto max-w-full justify-start gap-1.5 px-0 font-normal text-foreground"
      >
        <a
          href={href}
          onClick={(event) => {
            event.preventDefault();
            void open();
          }}
        >
          <Link className="size-3.5 shrink-0" />
          <span className="truncate">{reference.title || copy.unnamed}</span>
        </a>
      </Button>
      {error && (
        <span role="alert" className="block text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}

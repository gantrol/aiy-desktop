import { useCallback, useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { FileCode2Icon, LoaderCircleIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { htmlFileAttributesSchema, type HtmlFilePreviewAccess } from '@/shared/contracts/html-file';
import { HtmlFilePreviewDialog } from '@/renderer/features/content-editor/HtmlFilePreviewDialog';
import { useReadingHost } from '@/renderer/features/creation-reading/ReadingHost';

export function ContentHtmlFile(props: NodeViewProps) {
  return <HtmlFileNode key={`${props.node.attrs.spaceId}:${props.node.attrs.objectHash}`} {...props} />;
}

function HtmlFileNode({ node }: NodeViewProps) {
  const reading = useReadingHost();
  const copy = useI18n().messages.htmlFiles;
  const [access, setAccess] = useState<HtmlFilePreviewAccess | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = useCallback(() => setAccess(null), []);
  const generation = useRef(0);
  const opening = useRef(false);
  const objectHash = node.attrs.objectHash,
    spaceId = node.attrs.spaceId;
  useEffect(() => {
    const invalidate = () => {
      generation.current++;
    };
    const cancel = () => {
      invalidate();
      setAccess(null);
      setBusy(false);
    };
    const disconnect = window.desktopApi?.onLocalSpaceTransition(cancel);
    return () => {
      invalidate();
      disconnect?.();
    };
  }, [objectHash, spaceId]);
  useEffect(
    () => () => {
      if (access) void window.desktopApi?.htmlFileRelease({ previewId: access.previewId }).catch(() => undefined);
    },
    [access],
  );
  const open = async () => {
    if (reading) {
      reading.openHtml(htmlFileAttributesSchema.parse(node.attrs));
      return;
    }
    if (opening.current) return;
    opening.current = true;
    const request = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const next = await window.desktopApi.htmlFilePreview(htmlFileAttributesSchema.parse(node.attrs));
      if (request !== generation.current) {
        await window.desktopApi.htmlFileRelease({ previewId: next.previewId });
        return;
      }
      setAccess(next);
    } catch {
      if (request === generation.current) setError(copy.previewFailed);
    } finally {
      opening.current = false;
      if (request === generation.current) setBusy(false);
    }
  };
  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      className={
        access ? 'inline-flex w-full max-w-full flex-wrap align-middle' : 'inline-flex max-w-full align-middle'
      }
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto max-w-full justify-start gap-1.5 rounded-sm px-1 py-0.5 text-inherit"
        disabled={busy}
        title={copy.preview}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          void open();
        }}
      >
        {busy ? (
          <LoaderCircleIcon className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
        ) : (
          <FileCode2Icon className="size-4 shrink-0" />
        )}
        <span className="truncate">{node.attrs.fileName}</span>
      </Button>
      {error && (
        <span role="alert" className="ml-2 text-xs text-destructive">
          {error}
        </span>
      )}
      {access && <HtmlFilePreviewDialog access={access} fileName={node.attrs.fileName} onClose={close} />}
    </NodeViewWrapper>
  );
}

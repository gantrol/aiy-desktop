import type { Editor, JSONContent } from '@tiptap/core';
import { useMemo, useRef } from 'react';
import { useLatestMicrotask } from '@/renderer/hooks/useLatestMicrotask';

interface ExternalEditorDocumentOptions<TNode, TBridge> {
  editor: Editor | null;
  nodes: readonly TNode[];
  signature: string;
  bridge: TBridge;
  currentSignature(editor: Editor): string;
  content(nodes: readonly TNode[], bridge: TBridge): JSONContent;
  onContentChange(editor: Editor): void;
}

export function useExternalEditorDocument<TNode, TBridge>(options: ExternalEditorDocumentOptions<TNode, TBridge>) {
  const desiredRef = useRef(options);
  desiredRef.current = options;
  const revision = useMemo(
    () => ({ bridge: options.bridge, signature: options.signature }),
    [options.bridge, options.signature],
  );

  useLatestMicrotask(options.editor, revision, (editor) => {
    if (editor.isDestroyed) return;
    const desired = desiredRef.current;
    if (desired.currentSignature(editor) === desired.signature) return;
    editor.commands.setContent(desired.content(desired.nodes, desired.bridge), { emitUpdate: false });
    if (!editor.isDestroyed) desired.onContentChange(editor);
  });
}

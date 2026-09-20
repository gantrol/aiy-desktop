import { Paperclip } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { PetalFileAttachments } from '@/renderer/features/desktop-petals/PetalFileAttachments';
import { registerWorkspaceDrain } from '@/renderer/components/workspace/workspace-drain';
import {
  useArticleEditorSession,
  useArticleEditorSessionSelector,
} from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { useI18n } from '@/renderer/i18n/useI18n';
import { NOTE_FILE_LIMITS } from '@/shared/contracts/note-files';
import type { ArticleDto } from '@/shared/contracts';

export function useArticleAttachments({
  spaceId,
  onSaved,
  notify,
}: {
  spaceId: string;
  onSaved(article: ArticleDto): void;
  notify(message: string): void;
}) {
  const session = useArticleEditorSession();
  const files = useArticleEditorSessionSelector((state) => state.persisted.article.content.files);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<Promise<boolean> | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = useI18n().messages.desktopPetals;

  useEffect(
    () =>
      registerWorkspaceDrain(async () => {
        if (pending.current && !(await pending.current)) throw new Error(copy.note.unsaved);
      }),
    [copy.note.unsaved],
  );

  const run = (action: (article: ArticleDto) => Promise<void>) => {
    if (pending.current) return pending.current;
    setBusy(true);
    const operation = (async () => {
      try {
        if (!(await session.flush('manual'))) return false;
        try {
          await action(session.capturePersistedArticle());
        } finally {
          const next = await window.desktopApi.articleOpen({
            spaceId,
            articleId: session.capturePersistedArticle().id,
          });
          session.receiveArticle(next.article);
          onSaved(next.article);
        }
        return true;
      } catch (reason) {
        notify(String(reason));
        return false;
      } finally {
        pending.current = null;
        setBusy(false);
      }
    })();
    pending.current = operation;
    return operation;
  };

  const importFiles = (selected: File[]) =>
    run(async (article) => {
      if (
        selected.length + (article.content.files?.length ?? 0) > NOTE_FILE_LIMITS.count ||
        selected.some((file) => file.size > NOTE_FILE_LIMITS.fileBytes) ||
        selected.reduce((size, file) => size + file.size, 0) > NOTE_FILE_LIMITS.batchBytes
      )
        throw new Error(copy.errors.fileLimit);
      let hash = article.contentHash;
      for (const file of selected) {
        const result = await window.desktopPetals.files({
          kind: 'import',
          id: article.id,
          expectedHash: hash,
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        });
        hash = result.contentHash;
      }
    });

  return {
    files: files ?? [],
    busy,
    input,
    openPicker: () => input.current?.click(),
    importFiles,
    openFile: (fileId: string) =>
      void window.desktopPetals
        .files({ kind: 'open', id: session.capturePersistedArticle().id, fileId })
        .catch((reason) => notify(String(reason))),
    removeFile: (fileId: string) =>
      run(async (article) => {
        await window.desktopPetals.files({
          kind: 'remove',
          id: article.id,
          expectedHash: article.contentHash,
          fileId,
        });
      }),
  };
}

export type ArticleAttachmentsController = ReturnType<typeof useArticleAttachments>;

export function ArticleAttachmentsInput({ attachments }: { attachments: ArticleAttachmentsController }) {
  const copy = useI18n().messages.desktopPetals;
  return (
    <Input
      ref={attachments.input}
      type="file"
      multiple
      className="hidden"
      aria-label={copy.files.choose}
      onChange={(event) => {
        const selected = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = '';
        if (selected.length) void attachments.importFiles(selected);
      }}
    />
  );
}

export function ArticleAttachments({
  spaceId,
  attachments,
}: {
  spaceId: string;
  attachments: ArticleAttachmentsController;
}) {
  const session = useArticleEditorSession();
  const copy = useI18n().messages.desktopPetals;
  return (
    <div className="flex min-h-full min-w-0 flex-col">
      <div className="sticky -top-3 z-20 -mx-3 -mt-3 flex min-h-10 shrink-0 items-center justify-end border-b bg-background px-3">
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={attachments.busy}
          aria-label={copy.files.add}
          title={copy.files.add}
          onClick={attachments.openPicker}
        >
          <Paperclip className="size-3.5" />
        </Button>
      </div>
      <PetalFileAttachments
        files={attachments.files}
        libraryId={spaceId}
        stashId={session.capturePersistedArticle().id}
        disabled={attachments.busy}
        onOpen={attachments.openFile}
        onRemove={attachments.removeFile}
      />
      {!attachments.files.length && (
        <div className="grid min-h-24 flex-1 place-items-center text-muted-foreground">
          <Paperclip className="size-5" aria-label={copy.files.title} />
        </div>
      )}
    </div>
  );
}

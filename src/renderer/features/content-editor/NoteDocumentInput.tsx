import { ContentInput } from '@/renderer/features/content-editor/ContentInput';
import type { NoteEditSession } from '@/renderer/features/desktop-petals/note-edit-session';
import { blockDocumentMarkdown } from '@/shared/block-document-codecs';
import { plainTextMarkdown } from '@/shared/content-document';
import { blockDocumentAssetIds } from '@/shared/contracts/block-document';
import type { ComponentProps } from 'react';

type Props = Pick<
  ComponentProps<typeof ContentInput>,
  | 'compact'
  | 'embedded'
  | 'toolbarVisible'
  | 'toolbarRoot'
  | 'readOnly'
  | 'onHandleChange'
  | 'importImage'
  | 'onError'
  | 'articleElements'
  | 'articleElementControls'
  | 'onArticleElementsChange'
> & {
  session: NoteEditSession;
  state: ReturnType<NoteEditSession['getSnapshot']>;
};

export function NoteDocumentInput({ session, state, ...props }: Props) {
  return (
    <ContentInput
      {...props}
      contentSource={state.note.temporary ? undefined : { kind: 'INSPIRATION_STASH', id: state.note.stashId }}
      document={state.document}
      onDocumentChange={(document) =>
        session.edit(blockDocumentMarkdown(document), {
          document,
          format: 'markdown',
          referenceAssetIds: [
            ...new Set([...session.getSnapshot().referenceAssetIds, ...blockDocumentAssetIds(document)]),
          ],
        })
      }
      markdown={state.format === 'markdown' ? state.text : plainTextMarkdown(state.text)}
      sessionIdentity={`${state.note.id}:${state.editorEpoch}`}
      assets={state.referenceAssetIds.map((id) => ({
        id,
        mediaUrl:
          state.note.references.find((reference) => reference.assetId === id)?.mediaUrl ??
          (state.note.temporary
            ? `aiy-media://temporary/${state.note.id}/${encodeURIComponent(id)}`
            : `aiy-media://asset/${encodeURIComponent(id)}`),
      }))}
      onChange={(markdown) => session.edit(markdown, { format: 'markdown' })}
      onInputPendingChange={(pending) => session.setComposing(pending)}
      onSave={() => void session.flush()}
      onImageImported={(image) => {
        const current = session.getSnapshot();
        session.edit(current.text, {
          referenceAssetIds: [...new Set([...current.referenceAssetIds, image.binding.assetId])],
        });
      }}
    />
  );
}

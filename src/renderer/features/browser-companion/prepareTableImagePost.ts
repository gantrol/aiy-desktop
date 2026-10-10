import { publicationContainsTables } from '@/shared/publication-tables';
import { publishingMessages } from '@/shared/i18n/publishing';
import type { BrowserCompanionWatermarkSelection } from '@/shared/contracts';
import { prepareImagePostHandoff } from '@/renderer/features/browser-companion/prepareImagePostHandoff';

export async function prepareTableImagePost(
  input: Parameters<typeof prepareImagePostHandoff>[0],
  spaceId: string,
  watermark: BrowserCompanionWatermarkSelection = { kind: 'NONE' },
  tableLabel: string = publishingMessages.tables.table,
  signal?: AbortSignal,
) {
  if (input.format !== 'markdown' || !publicationContainsTables(input.body)) return prepareImagePostHandoff(input);
  if (input.target === 'chatgpt') throw new Error('TABLE_STRUCTURE_UNSUPPORTED');
  const requestId = crypto.randomUUID();
  const discard = () => {
    void window.desktopApi
      .browserCompanionDiscardTablePreviews({ expectedSpaceId: spaceId, ids: [requestId] })
      .catch(() => undefined);
  };
  signal?.throwIfAborted();
  signal?.addEventListener('abort', discard, { once: true });
  try {
    const converted = await window.desktopApi.browserCompanionPrepareTables({
      requestId,
      expectedSpaceId: spaceId,
      source: input.source,
      target: input.target,
      markdown: input.body,
      leadingMediaAssetIds: [...(input.leadingMediaAssetIds ?? [])],
      mediaAssetIds: [...input.mediaAssetIds],
      mediaBindings: [...input.mediaBindings],
      preferredMediaAssetIds: input.preferredMediaAssetIds ? [...input.preferredMediaAssetIds] : null,
      watermark,
      tableLabel,
    });
    signal?.throwIfAborted();
    const result = prepareImagePostHandoff({
      ...input,
      body: converted.markdown,
      leadingMediaAssetIds: [],
      mediaAssetIds: converted.mediaAssetIds,
      mediaBindings: converted.mediaBindings,
      preferredMediaAssetIds: converted.mediaAssetIds,
    });
    if (!result) {
      discard();
      return null;
    }
    return { ...result, tableConversion: { ...converted.preview, titleInBody: input.titleInBody ?? true } };
  } catch (reason) {
    discard();
    throw reason;
  } finally {
    signal?.removeEventListener('abort', discard);
  }
}

export function discardTablePreviews(spaceId: string, items: readonly { tableConversion?: { id: string } }[]) {
  const ids = [...new Set(items.flatMap((item) => (item.tableConversion ? [item.tableConversion.id] : [])))];
  if (ids.length)
    void window.desktopApi
      .browserCompanionDiscardTablePreviews({ expectedSpaceId: spaceId, ids })
      .catch(() => undefined);
}

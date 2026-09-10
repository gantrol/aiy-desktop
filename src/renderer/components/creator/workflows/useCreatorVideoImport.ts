import { useEffect, useRef, useState } from 'react';
import type { CreationVideoAttachmentDto, IntakeCommitInput, Locale } from '@/shared/contracts';
import { intakeMediaMimeType, isIntakeVideoMimeType } from '@/renderer/features/intake/intakeImageFormats';
import { intakePreview, releaseIntakePreview } from '@/renderer/features/intake/intakePreview';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

const maxVideos = 8;
const maxBatchBytes = 100 * 1024 * 1024;

export async function importCreatorVideos(
  files: readonly File[],
  source: 'DROP' | 'UPLOAD',
  sourceUrl: string,
  isCurrent: () => boolean,
) {
  const items: IntakeCommitInput['items'] = [];
  const skipped: string[] = [];
  let bytesUsed = 0;
  for (const file of files) {
    if (!isCurrent()) return null;
    const mimeType = intakeMediaMimeType(file);
    if (
      !mimeType ||
      !isIntakeVideoMimeType(mimeType) ||
      !file.size ||
      items.length >= maxVideos ||
      bytesUsed + file.size > maxBatchBytes
    ) {
      skipped.push(file.name);
      continue;
    }
    try {
      const preview = await intakePreview(file, true);
      try {
        if (!isCurrent()) return null;
        if (!preview.durationMs) throw new Error('Video duration unavailable');
        const bytes = new Uint8Array(await file.arrayBuffer());
        items.push({
          id: crypto.randomUUID(),
          kind: 'VIDEO',
          name: file.name,
          mimeType,
          width: preview.width,
          height: preview.height,
          durationMs: preview.durationMs,
          bytes,
          sourceUrl,
        });
        bytesUsed += file.size;
      } finally {
        releaseIntakePreview(preview.url);
      }
    } catch {
      skipped.push(file.name);
    }
  }
  if (!isCurrent()) return null;
  const result = items.length
    ? await window.desktopApi.intakeCommit({ intent: 'IMPORT', source, albumId: null, items })
    : null;
  return { attachments: result?.videoAttachments ?? [], skipped };
}

interface Options {
  scopeKey: string;
  attachToDraft: boolean;
  locale: Locale;
  notify(message: string): void;
  updateAttachments(update: (current: CreationVideoAttachmentDto[]) => CreationVideoAttachmentDto[]): void;
}

export function useCreatorVideoImport(options: Options) {
  const [importing, setImporting] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(false);
  const scope = useRef(options.scopeKey);
  scope.current = options.scopeKey;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const importFiles = useStableCallback(async (files: File[], source: 'DROP' | 'UPLOAD', sourceUrl: string = '') => {
    if (busy.current) return;
    busy.current = true;
    setImporting(true);
    const capturedScope = options.scopeKey;
    const isCurrent = () => mounted.current && scope.current === capturedScope;
    const zh = options.locale === 'zh';
    try {
      const imported = await importCreatorVideos(files, source, sourceUrl, isCurrent);
      if (!imported || !isCurrent()) return;
      if (options.attachToDraft) {
        options.updateAttachments((current) => {
          const unique = new Map<string, CreationVideoAttachmentDto>(
            [...current, ...imported.attachments].map((video) => [video.materialId, video]),
          );
          if (unique.size > maxVideos)
            options.notify(
              zh
                ? '草稿最多附加 8 个视频，其余已保存在图库中'
                : 'A draft holds up to 8 videos. Additional imports are saved in the library.',
            );
          return [...unique.values()].slice(0, maxVideos);
        });
      } else if (imported.attachments.length) {
        options.notify(zh ? '视频已保存在图库中' : 'Videos saved in the library');
      }
      if (imported.skipped.length)
        options.notify(
          zh
            ? `未导入：${imported.skipped.join('、')}。请检查格式和大小；每批最多 8 个视频、100 MB。`
            : `Not imported: ${imported.skipped.join(', ')}. Check format and size; at most 8 videos and 100 MB per batch.`,
        );
    } catch (reason) {
      if (isCurrent()) options.notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      busy.current = false;
      if (mounted.current) setImporting(false);
    }
  });
  return { importing, importFiles };
}

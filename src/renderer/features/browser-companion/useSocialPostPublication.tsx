import { useState } from 'react';
import { publicationContainsTables } from '@/shared/publication-tables';
import { discardTablePreviews } from '@/renderer/features/browser-companion/prepareTableImagePost';
import { useI18n } from '@/renderer/i18n/useI18n';
import { SocialPostPublishingDialog } from '@/renderer/features/browser-companion/SocialPostPublishingDialog';
import { prepareSocialPostHandoff } from '@/renderer/features/browser-companion/prepareSocialPostHandoff';
import { useBrowserCompanionHandoff } from '@/renderer/features/browser-companion/useBrowserCompanionHandoff';
import {
  isPublishingMaskError,
  publishingMaskErrorMessage,
} from '@/renderer/features/browser-companion/publishingMask';
import type {
  AssetDto,
  BrowserCompanionTarget,
  BrowserCompanionWatermarkSelection,
  SocialPostContentInput,
} from '@/shared/contracts';

export function useSocialPostPublication({
  spaceId,
  content,
  dirty,
  notify,
  persist,
  postId,
  targets,
  assets,
  readSavedContent,
  readSavedRevisionId,
}: {
  spaceId: string;
  content: SocialPostContentInput;
  dirty: boolean;
  notify(message: string): void;
  persist(snapshot: SocialPostContentInput): Promise<boolean>;
  postId: string;
  targets: readonly BrowserCompanionTarget[];
  assets: readonly AssetDto[];
  readSavedContent(): SocialPostContentInput;
  readSavedRevisionId(): string;
}) {
  const { messages } = useI18n();
  const copy = messages.desktopPetals.document;
  const report = (message: string) =>
    notify(isPublishingMaskError(message) ? publishingMaskErrorMessage(message, messages) : message);
  const [publishing, setPublishing] = useState<{
    targets: readonly BrowserCompanionTarget[];
    watermark: BrowserCompanionWatermarkSelection;
  } | null>(null);
  const { busy, handoff } = useBrowserCompanionHandoff({
    notify: report,
    review: (target, watermark, prepared) => {
      discardTablePreviews(spaceId, [prepared]);
      setPublishing({ targets: [target], watermark });
    },
    prepare: (target, watermark) =>
      prepareSocialPostHandoff({
        spaceId,
        content,
        dirty,
        notify: report,
        persist,
        postId,
        target,
        watermark,
        tableLabel: messages.publishing.tables.table,
        copy,
        readSavedContent,
        readSavedRevisionId,
      }),
  });
  return {
    busy,
    handoff: (target: BrowserCompanionTarget, watermark: BrowserCompanionWatermarkSelection = { kind: 'NONE' }) => {
      if (content.format === 'markdown' && publicationContainsTables(content.body)) {
        setPublishing({ targets: [target], watermark });
        return Promise.resolve();
      }
      return handoff(target, watermark);
    },
    prepareBatch: (watermark: BrowserCompanionWatermarkSelection) => setPublishing({ targets, watermark }),
    prepareWechatArticle: (watermark: BrowserCompanionWatermarkSelection) =>
      setPublishing({ targets: ['wechat'], watermark }),
    dialog: publishing ? (
      <SocialPostPublishingDialog
        spaceId={spaceId}
        content={content}
        dirty={dirty}
        postId={postId}
        persist={persist}
        readSavedContent={readSavedContent}
        readSavedRevisionId={readSavedRevisionId}
        assets={assets}
        targets={targets}
        initialTargets={publishing.targets}
        watermark={publishing.watermark}
        onClose={() => setPublishing(null)}
      />
    ) : null,
  };
}

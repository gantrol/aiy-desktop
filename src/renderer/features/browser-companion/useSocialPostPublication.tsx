import { useState } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { SocialPostPublishingDialog } from '@/renderer/features/browser-companion/SocialPostPublishingDialog';
import { prepareSocialPostHandoff } from '@/renderer/features/browser-companion/prepareSocialPostHandoff';
import { useBrowserCompanionHandoff } from '@/renderer/features/browser-companion/useBrowserCompanionHandoff';
import type {
  AssetDto,
  BrowserCompanionTarget,
  BrowserCompanionWatermarkSelection,
  SocialPostContentInput,
} from '@/shared/contracts';

export function useSocialPostPublication({
  content,
  dirty,
  notify,
  persist,
  postId,
  targets,
  assets,
  readSavedContent,
}: {
  content: SocialPostContentInput;
  dirty: boolean;
  notify(message: string): void;
  persist(snapshot: SocialPostContentInput): Promise<boolean>;
  postId: string;
  targets: readonly BrowserCompanionTarget[];
  assets: readonly AssetDto[];
  readSavedContent(): SocialPostContentInput;
}) {
  const copy = useI18n().messages.desktopPetals.document;
  const [publishing, setPublishing] = useState<{
    targets: readonly BrowserCompanionTarget[];
    watermark: BrowserCompanionWatermarkSelection;
  } | null>(null);
  const { busy, handoff } = useBrowserCompanionHandoff({
    notify,
    prepare: (target) =>
      prepareSocialPostHandoff({ content, dirty, notify, persist, postId, target, copy, readSavedContent }),
  });
  return {
    busy,
    handoff,
    prepareBatch: (watermark: BrowserCompanionWatermarkSelection) => setPublishing({ targets, watermark }),
    prepareWechatArticle: (watermark: BrowserCompanionWatermarkSelection) =>
      setPublishing({ targets: ['wechat'], watermark }),
    dialog: publishing ? (
      <SocialPostPublishingDialog
        content={content}
        dirty={dirty}
        postId={postId}
        persist={persist}
        readSavedContent={readSavedContent}
        assets={assets}
        targets={targets}
        initialTargets={publishing.targets}
        watermark={publishing.watermark}
        onClose={() => setPublishing(null)}
      />
    ) : null,
  };
}

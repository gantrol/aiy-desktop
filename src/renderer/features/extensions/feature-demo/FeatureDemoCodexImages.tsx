import { ImagesIcon, ImportIcon } from 'lucide-react';
import type { CodexGeneratedImageDto } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { CodexImageTaskGroup } from '@/renderer/features/extensions/CodexImageTaskGroup';
import { useI18n } from '@/renderer/i18n/useI18n';
import portraits from '../../../../../extensions/com.aiy.feature-demo/assets/features/portraits.json';
import portrait1 from '../../../../../extensions/com.aiy.feature-demo/assets/features/portrait-1.png?url';
import portrait2 from '../../../../../extensions/com.aiy.feature-demo/assets/features/portrait-2.png?url';
import portrait3 from '../../../../../extensions/com.aiy.feature-demo/assets/features/portrait-3.png?url';

const portraitUrls = [portrait1, portrait2, portrait3];
const ignore = () => undefined;
const selectedIds = new Set<string>();
const bundledThumbnailUrl = (image: CodexGeneratedImageDto) => image.mediaUrl;

export function FeatureDemoCodexImages() {
  const { messages } = useI18n();
  const labels = messages.extensions.codexImageDiscovery;
  const threadName = messages.extensions.featureDemo.codexSampleTitle;
  const images: CodexGeneratedImageDto[] = portraits.map((portrait, index) => ({
    ...portrait,
    threadId: 'demo-studio-portraits',
    threadName,
    threadTitleAvailable: true,
    mediaUrl: portraitUrls[index]!,
    mimeType: 'image/png',
    importable: true,
    imported: false,
    importedSeriesId: null,
    importedAssetId: null,
    recoveryTarget: null,
  }));

  return (
    <section data-feature-demo-state="ready" className="flex size-full min-h-0 flex-col bg-background">
      <header className="flex min-h-14 shrink-0 items-center gap-2 border-b px-5 py-2">
        <ImagesIcon className="size-4" />
        <h2 className="text-base font-semibold">{labels.title}</h2>
        <Button type="button" size="sm" className="ml-auto" disabled>
          <ImportIcon className="size-4" />
          {labels.actions.importSelected}
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <CodexImageTaskGroup
          group={{ threadId: 'demo-studio-portraits', threadName, threadTitleAvailable: true, images }}
          selectedIds={selectedIds}
          busy={false}
          getThumbnailUrl={bundledThumbnailUrl}
          onToggleImage={ignore}
          onSelectTask={ignore}
          onOpenCodex={ignore}
          onOpenCreation={ignore}
          onRecoverImage={ignore}
        />
      </div>
    </section>
  );
}

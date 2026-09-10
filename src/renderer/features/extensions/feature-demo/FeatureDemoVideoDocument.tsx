import { AssetMedia } from '@/renderer/components/media/AssetMedia';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { VideoDocumentArticle } from '@/renderer/features/video-documents/VideoDocumentArticle';
import { VideoDocumentTranscript } from '@/renderer/features/video-documents/VideoDocumentTranscript';
import { VideoKeyChangePanel } from '@/renderer/features/video-documents/VideoKeyChangePanel';
import { videoDemoTabAt } from '@/renderer/features/extensions/feature-demo/featureDemoSceneState';
import type { FeatureDemoVideoState } from '@/renderer/features/extensions/feature-demo/useFeatureDemoVideoSnapshot';
import { useI18n } from '@/renderer/i18n/useI18n';

export function FeatureDemoVideoDocument({ state, progress }: { state: FeatureDemoVideoState; progress: number }) {
  const copy = useI18n().messages.extensions.featureDemo.video;
  if (state.status !== 'ready') {
    const label = state.status === 'error' ? copy.loadFailed : state.status === 'empty' ? copy.empty : copy.loading;
    return (
      <div
        data-feature-demo-state={state.status === 'idle' ? 'loading' : state.status}
        role="status"
        className="grid size-full place-items-center text-sm text-muted-foreground"
      >
        {label}
      </div>
    );
  }
  const { durationMs, previewUrl, article, transcript, keyChanges } = state.snapshot;
  const tab = videoDemoTabAt(progress);
  return (
    <div data-feature-demo-state="ready" className="flex size-full min-h-0 gap-6">
      <aside className="flex w-80 shrink-0 flex-col gap-4">
        <h3 className="break-words text-base font-medium">{copy.sampleTitle}</h3>
        {previewUrl ? (
          <AssetMedia
            asset={{ mediaUrl: previewUrl, mimeType: 'image/jpeg' }}
            alt={copy.sampleTitle}
            className="aspect-video w-full object-contain"
          />
        ) : (
          <span className="text-sm text-muted-foreground">{copy.noPreview}</span>
        )}
      </aside>
      <Tabs value={tab} className="flex min-w-0 flex-1 flex-col gap-3">
        <TabsList className="shrink-0 self-start">
          <TabsTrigger value="frames">{copy.frames}</TabsTrigger>
          <TabsTrigger value="transcript">{copy.transcript}</TabsTrigger>
          <TabsTrigger value="article">{copy.article}</TabsTrigger>
        </TabsList>
        <TabsContent value="frames" className="min-h-0 flex-1">
          <ScrollArea className="h-full pr-3">
            <VideoKeyChangePanel
              result={keyChanges}
              loading={false}
              extracting={false}
              onExtract={() => undefined}
              onSeek={() => undefined}
            />
          </ScrollArea>
        </TabsContent>
        <TabsContent value="transcript" className="min-h-0 flex-1 overflow-y-auto">
          {transcript ? (
            <VideoDocumentTranscript revision={transcript} durationMs={durationMs} onSeek={() => undefined} />
          ) : (
            <span className="text-sm text-muted-foreground">{copy.noTranscript}</span>
          )}
        </TabsContent>
        <TabsContent value="article" className="min-h-0 flex-1 overflow-y-auto">
          {article ? (
            <VideoDocumentArticle
              documentTitle={copy.sampleTitle}
              revision={article}
              transcriptRevision={transcript}
              onSeek={() => undefined}
            />
          ) : (
            <span className="text-sm text-muted-foreground">{copy.noArticle}</span>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

import { useState, type ReactNode } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { contentLibraryApi } from '@/renderer/features/content-editor/ContentReferencePicker';
import { demoOutroMedia, demoStoreBadges } from '@/renderer/features/extensions/feature-demo/v050/demoOutroMedia';
import { useI18n } from '@/renderer/i18n/useI18n';

export function DemoOutroDownloads({ progress, onError }: { progress: number; onError(): void }) {
  const { locale, messages } = useI18n();
  const [openFailed, setOpenFailed] = useState(false);
  const revealed = progress === 1;
  const link = (url: string, children: ReactNode) => (
    <Button asChild variant="ghost" className="h-auto shrink-0 rounded-none p-0 hover:bg-transparent">
      <a
        href={url}
        tabIndex={revealed ? 0 : -1}
        onAuxClick={(event) => event.preventDefault()}
        onClick={(event) => {
          event.preventDefault();
          if (!revealed) return;
          setOpenFailed(false);
          void contentLibraryApi()
            .linkOpen(url)
            .catch(() => setOpenFailed(true));
        }}
      >
        {children}
      </a>
    </Button>
  );
  return (
    <div
      aria-hidden={!revealed}
      style={{
        opacity: progress,
        transform: `translateY(${8 * (1 - progress)}px)`,
        pointerEvents: revealed ? 'auto' : 'none',
      }}
    >
      <div className="flex flex-wrap items-center gap-x-10 gap-y-6">
        {link(
          'https://apps.microsoft.com/detail/9NWD1HG6TCZH',
          <img
            src={demoStoreBadges[locale]}
            alt={messages.extensions.featureDemo.v050.outro.storeDownload}
            className="h-[88px] w-[322px]"
            onError={onError}
          />,
        )}
        {link(
          'https://github.com/gantrol/aiy-desktop',
          <span className="flex items-center gap-4">
            <img src={demoOutroMedia.github} alt="GitHub" className="size-11" onError={onError} />
            <span className="text-[30px] font-normal leading-none">gantrol/aiy-desktop</span>
          </span>,
        )}
      </div>
      {openFailed && (
        <span role="alert" className="mt-3 block text-sm text-destructive">
          {messages.desktopPetals.editor.linkOpenFailed}
        </span>
      )}
    </div>
  );
}

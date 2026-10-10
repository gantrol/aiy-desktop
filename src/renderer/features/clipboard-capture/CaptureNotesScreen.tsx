import { useState } from 'react';
import { Settings2, GalleryHorizontalEnd, ShieldCheck } from 'lucide-react';
import { CaptureToolButton } from '@/renderer/features/clipboard-capture/CaptureToolButton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { useI18n } from '@/renderer/i18n/useI18n';
import { TemporaryFilesPanel } from '@/renderer/features/desktop-petals/TemporaryFilesPanel';
import { CaptureHistoryScreen } from '@/renderer/features/clipboard-capture/CaptureHistoryScreen';
import { ClipboardSettingsDialog } from '@/renderer/features/clipboard-capture/ClipboardSettingsDialog';
import { useClipboardHistory } from '@/renderer/features/clipboard-capture/useClipboardHistory';
import { CaptureButton } from '@/renderer/features/clipboard-capture/CaptureButton';
import { ImageStitchDialog } from '@/renderer/features/image-editing/ImageStitchDialog';

interface Props {
  active: boolean;
  spaceId: string;
  notify(message: string): void;
  onOpenPermissions?(): void;
}

export function CaptureNotesScreen(props: Props) {
  const l = useI18n().messages.clipboardCapture;
  const [tab, setTab] = useState('history');
  if (!props.active) return null;
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="history">{l.captureHistory}</TabsTrigger>
        <TabsTrigger value="tools">{l.temporaryItems}</TabsTrigger>
      </TabsList>
      <TabsContent value="tools" className="pt-3">
        <ToolsHome {...props} />
      </TabsContent>
      <TabsContent value="history" className="pt-3">
        <CaptureHistoryScreen {...props} />
      </TabsContent>
    </Tabs>
  );
}

function ToolsHome({ active, notify, onOpenPermissions }: Props) {
  const l = useI18n().messages.clipboardCapture;
  const controller = useClipboardHistory(active, notify, false, 'capture');
  const { status, busy, error, errorText } = controller;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stitchOpen, setStitchOpen] = useState(false);
  const captureState = !status
    ? null
    : !status.supported
      ? l.errors.unsupported
      : !status.enabled
        ? l.disabled
        : !status.canCapture
          ? l.permissionRequired
          : null;
  return (
    <div className="grid gap-3">
      <TemporaryFilesPanel
        imageEditing
        leadingActions={<CaptureButton controller={controller} />}
        trailingActions={
          <>
            <CaptureToolButton label={l.tools.stitch} onClick={() => setStitchOpen(true)}>
              <GalleryHorizontalEnd />
            </CaptureToolButton>
            {status?.supported && !status.canCapture && onOpenPermissions && (
              <CaptureToolButton label={l.tools.permissions} onClick={onOpenPermissions}>
                <ShieldCheck />
              </CaptureToolButton>
            )}
            <CaptureToolButton
              label={l.settings}
              size="icon-sm"
              variant="ghost"
              disabled={!status || busy}
              aria-label={l.settings}
              title={l.settings}
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 />
            </CaptureToolButton>
          </>
        }
      />
      {captureState && (
        <p role="status" className="text-sm text-muted-foreground">
          {captureState}
        </p>
      )}
      {(error || status?.error) && (
        <p role="alert" className="text-sm text-destructive">
          {error || errorText(status!.error!)}
        </p>
      )}
      {settingsOpen && status && (
        <ClipboardSettingsDialog status={status} controller={controller} onClose={() => setSettingsOpen(false)} />
      )}
      {stitchOpen && <ImageStitchDialog onClose={() => setStitchOpen(false)} />}
    </div>
  );
}

import { useRef, useState } from 'react';
import { FileTextIcon, ImagesIcon, ListTreeIcon, MessageSquareIcon, PaperclipIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { AssetMedia } from '@/renderer/components/media/AssetMedia';
import { WorkbenchPaneHeader } from '@/renderer/components/workbench/WorkbenchPane';
import { ContentDocumentWorkspace } from '@/renderer/features/content-editor/ContentDocumentWorkspace';
import { ContentWorkspacePanels } from '@/renderer/features/content-editor/ContentWorkspacePanels';
import { ContentInput } from '@/renderer/features/content-editor/ContentInput';
import { articleTitleClassName } from '@/renderer/lib/articleTypography';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { cycleAssets, type CycleModel } from './creation-cycle-model';
import { DraftInputPane } from './creation-cycle-materials';
import { ProcessingWorkspace } from './creation-cycle-processing';
import { EditingContextBar } from './creation-cycle-navigation';

function DraftPanels({ model }: { model: CycleModel }) {
  const labels = useI18n().messages.contentEditor;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState('OUTLINE');
  return (
    <ContentWorkspacePanels
      active={active}
      open={open}
      onActiveChange={setActive}
      onOpenChange={setOpen}
      tabs={[
        {
          id: 'OUTLINE',
          icon: ListTreeIcon,
          label: labels.tableOfContents,
          content: (
            <Button
              variant="ghost"
              className="h-auto w-full justify-start whitespace-normal text-left"
              onClick={() =>
                model.editorHandle.current?.focusArticleElement(
                  model.editorHandle.current.getArticleCheckBlocks()[0]?.elementId ?? '',
                )
              }
            >
              {model.markdown.match(/^#{1,6}\s+(.+)$/m)?.[1] ?? model.title}
            </Button>
          ),
        },
        {
          id: 'MEDIA',
          icon: ImagesIcon,
          label: labels.media,
          count: model.adoptedAssetIds.length,
          content: (
            <div className="space-y-3">
              {cycleAssets
                .filter((asset) => model.adoptedAssetIds.includes(asset.id))
                .map((asset) => (
                  <AssetMedia key={asset.id} asset={asset} alt={model.copy.image} className="w-full object-contain" />
                ))}
              {!model.adoptedAssetIds.length && (
                <span className="text-xs text-muted-foreground">{model.copy.noMedia}</span>
              )}
            </div>
          ),
        },
        {
          id: 'FILES',
          icon: PaperclipIcon,
          label: labels.files,
          content: <span className="text-xs text-muted-foreground">{model.copy.noFiles}</span>,
        },
        {
          id: 'COMMENTS',
          icon: MessageSquareIcon,
          label: labels.comments,
          count: 1,
          content: (
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground">{model.copy.mine}</div>
              <p className="text-sm leading-relaxed">{model.copy.exampleComment}</p>
              <Button
                variant="outline"
                size="sm"
                disabled={model.inputIds.includes('feedback')}
                onClick={() => model.addInput('feedback')}
              >
                {model.inputIds.includes('feedback') ? model.copy.used : model.copy.addInput}
              </Button>
            </div>
          ),
        },
      ]}
    />
  );
}

function DraftEditor({ model }: { model: CycleModel }) {
  const scroll = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  function captureSelection() {
    const selection = window.getSelection();
    if (
      !selection?.anchorNode ||
      !selection.focusNode ||
      !body.current?.contains(selection.anchorNode) ||
      !body.current.contains(selection.focusNode)
    )
      return;
    model.setSelectedText(selection.toString().trim());
  }
  return (
    <ContentDocumentWorkspace
      documentWidth="WIDE"
      scrollRootRef={scroll}
      title={
        <Input
          value={model.title}
          disabled={model.busy}
          aria-label={model.copy.writing}
          onChange={(event) => model.setTitle(event.target.value)}
          className={cn(articleTitleClassName, 'h-auto border-0 px-0 shadow-none')}
        />
      }
      titleMetadata={
        <span className="text-xs text-muted-foreground">
          {model.copy.mine} · {model.copy.localDraft}
        </span>
      }
      sidePanel={model.output.kind === 'ARTICLE' ? <DraftPanels model={model} /> : undefined}
      toolbar={
        <WorkbenchPaneHeader>
          <FileTextIcon className="size-4" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {model.copy.output} · {model.contextLabel}
          </span>
          <span className="hidden text-xs text-muted-foreground xl:inline">
            {model.output.kind === 'ARTICLE' && (
              <>{model.selectedText ? model.copy.selectedPassage : model.copy.wholeDraft}</>
            )}
          </span>
          {model.output.kind === 'ARTICLE' && (
            <Button variant="ghost" size="sm" disabled={model.busy} onClick={() => void model.begin('rewrite')}>
              {model.copy.rewrite}
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={model.busy} onClick={() => void model.begin('image')}>
            {model.output.kind === 'IMAGE' ? model.copy.newCandidate : model.copy.illustrate}
          </Button>
        </WorkbenchPaneHeader>
      }
    >
      {model.output.kind === 'IMAGE' ? (
        <div className="flex justify-center py-6">
          {cycleAssets
            .filter((asset) => asset.id === model.draft.assetId)
            .map((asset) => (
              <AssetMedia
                key={asset.id}
                asset={asset}
                alt={model.title}
                className="max-h-[55dvh] w-full object-contain"
              />
            ))}
        </div>
      ) : (
        <div ref={body} onPointerUp={captureSelection} onKeyUp={captureSelection}>
          <ContentInput
            key={model.epoch}
            markdown={model.markdown}
            sessionIdentity={`cycle-draft-${model.contextKey}-${model.epoch}`}
            assets={cycleAssets}
            toolbarVisible={false}
            mediaIntake="EXTERNAL"
            onChange={model.setMarkdown}
            onHandleChange={(handle) => {
              model.editorHandle.current = handle;
            }}
            onSave={() => void model.saveRevision()}
            onError={() => model.setNotice(model.copy.sourceMissing)}
          />
        </div>
      )}
    </ContentDocumentWorkspace>
  );
}

export function WritingWorkspace({ model }: { model: CycleModel }) {
  return (
    <>
      <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', model.operation && 'hidden')}>
        <EditingContextBar model={model} />
        <div className="flex min-h-0 min-w-0 flex-1">
          <DraftInputPane model={model} />
          <DraftEditor key={model.contextKey} model={model} />
        </div>
      </div>
      {model.operation && <ProcessingWorkspace key={model.operation.kind} model={model} />}
    </>
  );
}

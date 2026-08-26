import {
  CheckIcon,
  CircleAlertIcon,
  CopyIcon,
  DownloadIcon,
  ImagePlusIcon,
  LoaderCircleIcon,
  PanelsTopLeftIcon,
  TextCursorInputIcon,
  XIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ComponentProps, type Dispatch, type SetStateAction } from 'react';
import type {
  ArticleContentInput,
  ArticleDto,
  CanvasPresetDto,
  Locale,
  VideoDocumentMediaBinding,
  VideoDocumentRevisionMediaDto,
} from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import {
  VideoDocumentWysiwygEditor,
  type VideoDocumentEditorImageImport,
} from '@/renderer/features/video-documents/VideoDocumentWysiwygEditor';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Props {
  article: ArticleDto;
  locale: Locale;
  canvasPresets: CanvasPresetDto[];
  headerWorkspaceExists: boolean;
  onSave(content: ArticleContentInput): Promise<ArticleDto>;
  onCopyForWechat(): Promise<void>;
  onExport(): Promise<void>;
  onCreateSocialPost(content: ArticleContentInput): Promise<void>;
  onGenerateHeader(content: ArticleContentInput): Promise<void>;
  onGenerateIllustration(content: ArticleContentInput, selectedText: string, preset: CanvasPresetDto): Promise<void>;
  notify(message: string): void;
}

function editableContent(article: ArticleDto): ArticleContentInput {
  const { mediaAssets: _mediaAssets, ...content } = article.content;
  return {
    ...content,
    mediaBindings: content.mediaBindings.map((binding) => ({ ...binding })),
  };
}

function editorBindings(content: ArticleContentInput): VideoDocumentMediaBinding[] {
  return content.mediaBindings.map((binding) => ({
    ...binding,
    kind: 'IMAGE',
    timestampMs: null,
    endTimestampMs: null,
    posterAssetId: null,
  }));
}

function editorMedia(article: ArticleDto): VideoDocumentRevisionMediaDto[] {
  return article.content.mediaAssets.map((asset) => ({
    assetId: asset.id,
    mediaUrl: asset.mediaUrl,
    mimeType: asset.mimeType as VideoDocumentRevisionMediaDto['mimeType'],
    width: asset.width,
    height: asset.height,
    byteSize: asset.byteSize ?? 0,
    durationMs: null,
  }));
}

function contentAfterImageImport(current: ArticleContentInput, result: VideoDocumentEditorImageImport) {
  if (current.mediaBindings.some((binding) => binding.assetId === result.binding.assetId)) return current;
  return {
    ...current,
    mediaBindings: [...current.mediaBindings, { path: result.binding.path, assetId: result.binding.assetId }],
    coverAssetId: current.coverAssetId ?? result.binding.assetId,
  };
}

function applyImageImport(
  result: VideoDocumentEditorImageImport,
  setContent: Dispatch<SetStateAction<ArticleContentInput>>,
  setMedia: Dispatch<SetStateAction<VideoDocumentRevisionMediaDto[]>>,
) {
  setContent((current) => contentAfterImageImport(current, result));
  setMedia((current) => [...current.filter((candidate) => candidate.assetId !== result.media.assetId), result.media]);
}

function SuggestedArticleTitle({
  onApply,
  onDismiss,
  title,
  zh,
}: {
  onApply(): void;
  onDismiss(): void;
  title: string;
  zh: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b bg-surface-sunken px-4 py-2">
      <TextCursorInputIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
      <Button type="button" variant="outline" size="sm" onClick={onApply}>
        {zh ? '采用' : 'Apply'}
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" title={zh ? '忽略' : 'Dismiss'} onClick={onDismiss}>
        <XIcon className="size-4" />
      </Button>
    </div>
  );
}

function ArticleHeaderActions({
  copyingForWechat,
  creatingSocialPost,
  exporting,
  generatingHeader,
  headerWorkspaceExists,
  hasBody,
  suggesting,
  zh,
  onCopyForWechat,
  onCreateSocialPost,
  onExport,
  onGenerateHeader,
  onSuggestTitle,
}: {
  copyingForWechat: boolean;
  creatingSocialPost: boolean;
  exporting: boolean;
  generatingHeader: boolean;
  headerWorkspaceExists: boolean;
  hasBody: boolean;
  suggesting: boolean;
  zh: boolean;
  onCopyForWechat(): Promise<void>;
  onCreateSocialPost(): Promise<void>;
  onExport(): Promise<void>;
  onGenerateHeader(): Promise<void>;
  onSuggestTitle(): Promise<void>;
}) {
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-action="open-article-header-workspace"
        data-workspace-state={headerWorkspaceExists ? 'existing' : 'new'}
        disabled={!hasBody || generatingHeader}
        onClick={() => void onGenerateHeader()}
      >
        {generatingHeader ? <LoaderCircleIcon className="size-4 animate-spin" /> : <ImagePlusIcon className="size-4" />}
        {headerWorkspaceExists ? (zh ? '继续题图创作' : 'Continue hero creation') : zh ? '生成题图' : 'Generate hero'}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={creatingSocialPost}
        onClick={() => void onCreateSocialPost()}
      >
        {creatingSocialPost ? (
          <LoaderCircleIcon className="size-4 animate-spin" />
        ) : (
          <PanelsTopLeftIcon className="size-4" />
        )}
        {zh ? '做成贴图' : 'Make social post'}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!hasBody || suggesting}
        onClick={() => void onSuggestTitle()}
      >
        {suggesting ? <LoaderCircleIcon className="size-4 animate-spin" /> : <TextCursorInputIcon className="size-4" />}
        {zh ? 'AI 起标题' : 'AI title'}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!hasBody || copyingForWechat}
        onClick={() => void onCopyForWechat()}
      >
        {copyingForWechat ? <LoaderCircleIcon className="size-4 animate-spin" /> : <CopyIcon className="size-4" />}
        {zh ? '复制公众号正文' : 'Copy for WeChat'}
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={exporting} onClick={() => void onExport()}>
        {exporting ? <LoaderCircleIcon className="size-4 animate-spin" /> : <DownloadIcon className="size-4" />}
        Markdown
      </Button>
    </>
  );
}

function useArticleVisualGeneration({
  canvasPresets,
  content,
  dirty,
  notify,
  onGenerateHeader,
  onGenerateIllustration,
  persist,
  zh,
}: {
  canvasPresets: CanvasPresetDto[];
  content: ArticleContentInput;
  dirty: boolean;
  notify(message: string): void;
  onGenerateHeader(content: ArticleContentInput): Promise<void>;
  onGenerateIllustration(content: ArticleContentInput, selectedText: string, preset: CanvasPresetDto): Promise<void>;
  persist(content: ArticleContentInput): Promise<boolean>;
  zh: boolean;
}) {
  const [generatingHeader, setGeneratingHeader] = useState(false);
  const [generatingIllustration, setGeneratingIllustration] = useState(false);
  const defaultIllustrationPreset = canvasPresets.find((preset) => preset.stableKey === 'landscape_4_3');

  async function generateHeader() {
    if (generatingHeader) return;
    if (dirty && !(await persist(content))) return;
    setGeneratingHeader(true);
    try {
      await onGenerateHeader(content);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setGeneratingHeader(false);
    }
  }

  async function generateIllustration(selectedText: string | null) {
    const selection = selectedText?.trim();
    if (!selection || generatingIllustration) return;
    if (!defaultIllustrationPreset) {
      notify(zh ? '正文配图画幅不可用' : 'Illustration canvas is unavailable');
      return;
    }
    if (dirty && !(await persist(content))) return;
    setGeneratingIllustration(true);
    try {
      await onGenerateIllustration(content, selection, defaultIllustrationPreset);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setGeneratingIllustration(false);
    }
  }

  return {
    generateHeader,
    generateIllustration,
    generatingHeader,
    generatingIllustration,
  };
}

function ArticleBody({
  content,
  generatingIllustration,
  labels,
  media,
  zh,
  onIllustrationRequest,
  onImageImportError,
  onImageImported,
  onMarkdownChange,
  onPersist,
  onTitleChange,
}: {
  content: ArticleContentInput;
  generatingIllustration: boolean;
  labels: ComponentProps<typeof VideoDocumentWysiwygEditor>['labels'];
  media: VideoDocumentRevisionMediaDto[];
  zh: boolean;
  onIllustrationRequest(selectedText: string | null): void;
  onImageImportError(): void;
  onImageImported(result: VideoDocumentEditorImageImport): void;
  onMarkdownChange(markdown: string): void;
  onPersist(content: ArticleContentInput): void;
  onTitleChange(title: string): void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-6">
      <div className="mx-auto w-full max-w-4xl px-6 lg:px-8">
        <Input
          value={content.title}
          maxLength={200}
          className="mb-5 h-auto border-0 px-0 text-3xl font-semibold shadow-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label={zh ? '文章标题' : 'Article title'}
          placeholder={zh ? '未命名文章' : 'Untitled article'}
          onChange={(event) => onTitleChange(event.target.value)}
          onBlur={() => onPersist(content)}
        />
        <VideoDocumentWysiwygEditor
          markdown={content.markdown}
          mediaBindings={editorBindings(content)}
          media={media}
          currentTimeMs={0}
          durationMs={0}
          timelineSegments={[]}
          ariaLabel={zh ? '文章正文' : 'Article body'}
          labels={labels}
          onChange={onMarkdownChange}
          onFrameCaptured={() => undefined}
          onImageImported={onImageImported}
          onImageImportError={onImageImportError}
          illustrationLabel={
            generatingIllustration
              ? zh
                ? '正在打开配图工作区'
                : 'Opening illustration workspace'
              : zh
                ? '生成配图'
                : 'Generate illustration'
          }
          onIllustrationRequest={onIllustrationRequest}
          onSave={(markdown) => onPersist({ ...content, markdown })}
        />
      </div>
    </div>
  );
}

export function ArticleEditor({
  article,
  locale,
  canvasPresets,
  headerWorkspaceExists,
  onSave,
  onCopyForWechat,
  onExport,
  onCreateSocialPost,
  onGenerateHeader,
  onGenerateIllustration,
  notify,
}: Props) {
  const zh = locale === 'zh';
  const { messages } = useI18n();
  const [content, setContent] = useState<ArticleContentInput>(() => editableContent(article));
  const [media, setMedia] = useState<VideoDocumentRevisionMediaDto[]>(() => editorMedia(article));
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(editableContent(article)));
  const savedJsonRef = useRef(savedJson);
  const articleIdRef = useRef(article.id);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [failedJson, setFailedJson] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestedTitle, setSuggestedTitle] = useState<string | null>(null);
  const [copyingForWechat, setCopyingForWechat] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [creatingSocialPost, setCreatingSocialPost] = useState(false);
  const contentJson = useMemo(() => JSON.stringify(content), [content]);
  const dirty = contentJson !== savedJson;
  const saveFailed = failedJson === contentJson;
  const saveForEffect = useStableCallback(onSave);
  const notifyForEffect = useStableCallback(notify);

  useEffect(() => {
    const incoming = editableContent(article);
    const incomingJson = JSON.stringify(incoming);
    if (articleIdRef.current !== article.id) {
      articleIdRef.current = article.id;
      savedJsonRef.current = incomingJson;
      setContent(incoming);
      setMedia(editorMedia(article));
      setSavedJson(incomingJson);
      setFailedJson(null);
      setSuggestedTitle(null);
      return;
    }
    const previousSavedJson = savedJsonRef.current;
    savedJsonRef.current = incomingJson;
    setSavedJson(incomingJson);
    setFailedJson((current) => (current === incomingJson ? null : current));
    setContent((current) => (JSON.stringify(current) === previousSavedJson ? incoming : current));
    setMedia((current) => {
      const merged = new Map(current.map((item) => [item.assetId, item]));
      editorMedia(article).forEach((item) => merged.set(item.assetId, item));
      return [...merged.values()];
    });
  }, [article]);

  const persist = useStableCallback(async (snapshot: ArticleContentInput) => {
    const snapshotJson = JSON.stringify(snapshot);
    if (snapshotJson === savedJsonRef.current) return true;
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    try {
      const saved = await saveForEffect(snapshot);
      savedJsonRef.current = snapshotJson;
      setSavedJson(snapshotJson);
      setFailedJson(null);
      setMedia((current) => {
        const merged = new Map(current.map((item) => [item.assetId, item]));
        editorMedia(saved).forEach((item) => merged.set(item.assetId, item));
        return [...merged.values()];
      });
      return true;
    } catch (reason) {
      setFailedJson(snapshotJson);
      const detail = reason instanceof Error ? reason.message : String(reason);
      notifyForEffect(zh ? `文章自动保存失败：${detail}` : `Could not autosave the article: ${detail}`);
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  });
  const { generateHeader, generateIllustration, generatingHeader, generatingIllustration } = useArticleVisualGeneration(
    {
      canvasPresets,
      content,
      dirty,
      notify,
      onGenerateHeader,
      onGenerateIllustration,
      persist,
      zh,
    },
  );

  useEffect(() => {
    if (!dirty || saving || saveFailed) return;
    const snapshot = content;
    const timeout = window.setTimeout(() => void persist(snapshot), 650);
    return () => window.clearTimeout(timeout);
  }, [content, dirty, persist, saveFailed, saving]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase() !== 's') return;
      event.preventDefault();
      void persist(content);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [content, persist]);

  async function suggestTitle() {
    const prompt = content.markdown.trim();
    if (!prompt || suggesting) return;
    setSuggesting(true);
    try {
      const result = await window.desktopApi.codexSuggestTitles({
        prompt: prompt.slice(0, 30_000),
        title: content.title,
        mode: content.title.trim() ? 'regenerate' : 'fill',
      });
      setSuggestedTitle(result.title.trim() || null);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSuggesting(false);
    }
  }

  async function exportMarkdown() {
    if (exporting) return;
    if (dirty && !(await persist(content))) return;
    setExporting(true);
    try {
      await onExport();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setExporting(false);
    }
  }

  async function copyForWechat() {
    if (copyingForWechat) return;
    if (dirty && !(await persist(content))) return;
    setCopyingForWechat(true);
    try {
      await onCopyForWechat();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCopyingForWechat(false);
    }
  }

  async function createSocialPost() {
    if (creatingSocialPost) return;
    if (dirty && !(await persist(content))) return;
    setCreatingSocialPost(true);
    try {
      await onCreateSocialPost(content);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCreatingSocialPost(false);
    }
  }

  const imageImported = (result: VideoDocumentEditorImageImport) => applyImageImport(result, setContent, setMedia);

  return (
    <div data-article-editor className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold">{content.title || (zh ? '未命名文章' : 'Untitled article')}</span>
          <span className="text-xs text-muted-foreground">{zh ? '文章' : 'Article'}</span>
        </div>
        <div className="flex items-center gap-1">
          <ArticleHeaderActions
            copyingForWechat={copyingForWechat}
            creatingSocialPost={creatingSocialPost}
            exporting={exporting}
            generatingHeader={generatingHeader}
            headerWorkspaceExists={headerWorkspaceExists}
            hasBody={Boolean(content.markdown.trim())}
            suggesting={suggesting}
            zh={zh}
            onCopyForWechat={copyForWechat}
            onCreateSocialPost={createSocialPost}
            onExport={exportMarkdown}
            onGenerateHeader={generateHeader}
            onSuggestTitle={suggestTitle}
          />
          <div className="grid size-8 place-items-center text-muted-foreground">
            {saving ? (
              <LoaderCircleIcon className="size-4 animate-spin" aria-label={zh ? '正在自动保存' : 'Autosaving'} />
            ) : saveFailed ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-destructive"
                title={zh ? '自动保存失败，点击重试' : 'Autosave failed. Retry'}
                onClick={() => void persist(content)}
              >
                <CircleAlertIcon className="size-4" />
              </Button>
            ) : dirty ? (
              <span
                className="size-1.5 rounded-full bg-muted-foreground"
                title={zh ? '等待自动保存' : 'Waiting to autosave'}
              />
            ) : (
              <CheckIcon className="size-4" aria-label={zh ? '已自动保存' : 'Autosaved'} />
            )}
          </div>
        </div>
      </header>

      {suggestedTitle && (
        <SuggestedArticleTitle
          title={suggestedTitle}
          zh={zh}
          onApply={() => {
            setContent((current) => ({ ...current, title: suggestedTitle }));
            setSuggestedTitle(null);
          }}
          onDismiss={() => setSuggestedTitle(null)}
        />
      )}

      <ArticleBody
        content={content}
        generatingIllustration={generatingIllustration}
        labels={messages.videoDocuments.editor.richText}
        media={media}
        zh={zh}
        onIllustrationRequest={(selectedText) => void generateIllustration(selectedText)}
        onImageImportError={() => notify(zh ? '图片导入失败' : 'Could not import image')}
        onImageImported={imageImported}
        onMarkdownChange={(markdown) => setContent((current) => ({ ...current, markdown }))}
        onPersist={(snapshot) => void persist(snapshot)}
        onTitleChange={(title) => {
          setSuggestedTitle(null);
          setContent((current) => ({ ...current, title }));
        }}
      />
    </div>
  );
}

import { ImagePlusIcon, LoaderCircleIcon, XIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { AlbumDto, CreatorImageImportSource, Locale } from '@/shared/contracts';
import { buildAlbumTreeIndex, flattenAlbumTree } from '@/renderer/components/albums/albumTree';
import { Button } from '@/renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Textarea } from '@/renderer/components/ui/textarea';
import { imageMimeType, type RendererImageImportSource } from '@/renderer/components/creator/imageImport';
import { PasteDropSurface } from '@/renderer/components/creator/intake/PasteDropSurface';

interface PendingImage {
  id: string;
  file: File;
  previewUrl: string;
}

export interface NewExternalCreationDialogValue {
  title: string;
  promptKnowledge: 'EXACT' | 'UNKNOWN';
  prompt: string;
  sourceUrl: string;
  source: CreatorImageImportSource;
  files: File[];
  albumId: string | null;
}

interface Props {
  open: boolean;
  locale: Locale;
  albums: AlbumDto[];
  defaultAlbumId?: string | null;
  initialFiles?: File[];
  initialSource?: RendererImageImportSource;
  initialSourceUrl?: string;
  onOpenChange(open: boolean): void;
  onCreate(value: NewExternalCreationDialogValue): Promise<void>;
}

const maxImages = 8;

function fileIdentity(file: File) {
  return `${file.name}\u0000${file.type}\u0000${file.size}\u0000${file.lastModified}`;
}

export function NewExternalCreationDialog({
  open,
  locale,
  albums,
  defaultAlbumId = null,
  initialFiles = [],
  initialSource = 'UPLOAD',
  initialSourceUrl = '',
  onOpenChange,
  onCreate,
}: Props) {
  const zh = locale === 'zh';
  const [title, setTitle] = useState('');
  const [promptKnowledge, setPromptKnowledge] = useState<'EXACT' | 'UNKNOWN'>('UNKNOWN');
  const [prompt, setPrompt] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [source, setSource] = useState<CreatorImageImportSource>('UPLOAD');
  const [albumId, setAlbumId] = useState(defaultAlbumId ?? '');
  const [images, setImages] = useState<PendingImage[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const imagesRef = useRef(images);
  const seededOpenRef = useRef(false);
  imagesRef.current = images;
  const albumRows = useMemo(() => flattenAlbumTree(buildAlbumTreeIndex(albums)), [albums]);

  useEffect(
    () => () => {
      for (const image of imagesRef.current) URL.revokeObjectURL(image.previewUrl);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    const selectableAlbumIds = new Set(albumRows.map((row) => row.album.id));
    setAlbumId(defaultAlbumId && selectableAlbumIds.has(defaultAlbumId) ? defaultAlbumId : '');
  }, [albumRows, defaultAlbumId, open]);

  function clear() {
    for (const image of imagesRef.current) URL.revokeObjectURL(image.previewUrl);
    setImages([]);
    setTitle('');
    setPromptKnowledge('UNKNOWN');
    setPrompt('');
    setSourceUrl('');
    setSource('UPLOAD');
    setError('');
  }

  function changeOpen(next: boolean) {
    if (submitting) return;
    if (!next) clear();
    onOpenChange(next);
  }

  const addImages = useCallback(
    (files: readonly File[], nextSource: RendererImageImportSource, nextSourceUrl = '') => {
      const existing = new Set(images.map((image) => fileIdentity(image.file)));
      const next = [...images];
      let rejection: 'TYPE' | 'SIZE' | 'LIMIT' | 'DUPLICATE' | null = null;
      for (const file of files) {
        if (!imageMimeType(file)) {
          rejection ??= 'TYPE';
          continue;
        }
        if (file.size <= 0 || file.size > 25 * 1024 * 1024) {
          rejection ??= 'SIZE';
          continue;
        }
        if (next.length >= maxImages) {
          rejection ??= 'LIMIT';
          continue;
        }
        if (existing.has(fileIdentity(file))) {
          rejection ??= 'DUPLICATE';
          continue;
        }
        existing.add(fileIdentity(file));
        next.push({ id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file) });
      }
      if (next.length > images.length && images.length === 0) setSource(nextSource);
      if (next.length > images.length && nextSourceUrl) setSourceUrl((current) => current || nextSourceUrl);
      setImages(next);
      setError(
        rejection === 'TYPE'
          ? zh
            ? '仅支持 PNG、JPEG、WebP 图片'
            : 'Only PNG, JPEG and WebP images are supported'
          : rejection === 'SIZE'
            ? zh
              ? '每张图片不能超过 25 MB'
              : 'Each image must be 25 MB or smaller'
            : rejection === 'LIMIT'
              ? zh
                ? '最多导入 8 张成果图'
                : 'Up to 8 output images can be imported'
              : rejection === 'DUPLICATE'
                ? zh
                  ? '相同文件已经添加'
                  : 'That file is already attached'
                : '',
      );
    },
    [images, zh],
  );

  useEffect(() => {
    if (!open) {
      seededOpenRef.current = false;
      return;
    }
    if (seededOpenRef.current) return;
    seededOpenRef.current = true;
    if (initialFiles.length) addImages(initialFiles, initialSource, initialSourceUrl);
  }, [addImages, initialFiles, initialSource, initialSourceUrl, open]);

  function removeImage(id: string) {
    setImages((current) =>
      current.filter((image) => {
        if (image.id !== id) return true;
        URL.revokeObjectURL(image.previewUrl);
        return false;
      }),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const exactPrompt = prompt.trim();
    const valid = images.length > 0 && (promptKnowledge === 'UNKNOWN' || Boolean(exactPrompt));
    if (!valid || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await onCreate({
        title: title.trim(),
        promptKnowledge,
        prompt: exactPrompt,
        sourceUrl: sourceUrl.trim(),
        source,
        files: images.map((image) => image.file),
        albumId: albumId || null,
      });
      clear();
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  }

  const valid = images.length > 0 && (promptKnowledge === 'UNKNOWN' || Boolean(prompt.trim()));

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-w-xl">
        <PasteDropSurface
          disabled={submitting}
          className="min-w-0"
          overlay={<ImagePlusIcon className="size-8 text-muted-foreground" />}
          onImages={addImages}
        >
          <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
            <DialogHeader>
              <DialogTitle>{zh ? '导入外部创作' : 'Import external creation'}</DialogTitle>
              <DialogDescription className="sr-only">
                {zh ? '用外部成果图直接创建 V01' : 'Create V01 directly from external output images'}
              </DialogDescription>
            </DialogHeader>

            <label className="grid gap-1.5 text-sm font-medium">
              {zh ? '标题' : 'Title'}
              <Input
                autoFocus
                value={title}
                maxLength={300}
                disabled={submitting}
                placeholder={zh ? '可选' : 'Optional'}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>

            <Segmented
              type="single"
              value={promptKnowledge}
              onValueChange={(value) => value && setPromptKnowledge(value as 'EXACT' | 'UNKNOWN')}
            >
              <SegmentedItem value="EXACT">{zh ? '有准确 Prompt' : 'Exact Prompt'}</SegmentedItem>
              <SegmentedItem value="UNKNOWN">{zh ? '不知道 Prompt' : 'Prompt unknown'}</SegmentedItem>
            </Segmented>

            {promptKnowledge === 'EXACT' && (
              <label className="grid gap-1.5 text-sm font-medium">
                Prompt
                <Textarea
                  value={prompt}
                  rows={5}
                  maxLength={30_000}
                  disabled={submitting}
                  className="resize-y"
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </label>
            )}

            <div className="grid gap-3 rounded-lg border border-dashed p-3">
              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                multiple
                className="sr-only"
                tabIndex={-1}
                onChange={(event) => {
                  addImages([...(event.currentTarget.files ?? [])], 'UPLOAD');
                  event.currentTarget.value = '';
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={submitting || images.length >= maxImages}
                onClick={() => inputRef.current?.click()}
              >
                <ImagePlusIcon className="size-4" />
                {zh ? '粘贴或上传成果图' : 'Paste or upload outputs'}
              </Button>
              {images.length > 0 && (
                <div className="grid grid-cols-4 gap-2">
                  {images.map((image) => (
                    <div
                      key={image.id}
                      className="group relative aspect-square overflow-hidden rounded-md border bg-media-surround-light"
                    >
                      <img src={image.previewUrl} alt={image.file.name} className="size-full object-contain" />
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon-sm"
                        className="absolute top-1 right-1 size-6 opacity-0 shadow-overlay group-hover:opacity-100 group-focus-within:opacity-100"
                        title={zh ? '移除' : 'Remove'}
                        aria-label={`${zh ? '移除' : 'Remove'}: ${image.file.name}`}
                        onClick={() => removeImage(image.id)}
                      >
                        <XIcon className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <label className="grid gap-1.5 text-sm font-medium">
              {zh ? '来源链接' : 'Source URL'}
              <Input
                type="url"
                value={sourceUrl}
                maxLength={2048}
                disabled={submitting}
                placeholder={zh ? '可选' : 'Optional'}
                onChange={(event) => setSourceUrl(event.target.value)}
              />
            </label>

            <label className="grid gap-1.5 text-sm font-medium">
              {zh ? '图集' : 'Album'}
              <Select
                value={albumId || '__none__'}
                disabled={submitting}
                onValueChange={(value) => setAlbumId(value === '__none__' ? '' : value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{zh ? '不归入图集' : 'No album'}</SelectItem>
                  {albumRows.map(({ album, depth }) => (
                    <SelectItem key={album.id} value={album.id}>{`${'　'.repeat(depth)}${album.title}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={submitting} onClick={() => changeOpen(false)}>
                {zh ? '取消' : 'Cancel'}
              </Button>
              <Button type="submit" disabled={submitting || !valid}>
                {submitting && <LoaderCircleIcon className="size-4 animate-spin" />}
                {zh ? '创建 V01' : 'Create V01'}
              </Button>
            </DialogFooter>
          </form>
        </PasteDropSurface>
      </DialogContent>
    </Dialog>
  );
}

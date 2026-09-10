import { isVisible, setMediaFiles } from '@/lib/composer-adapters/dom';

const coverRoot = '#js_cover_area';
const coverPreviews = '.js_cover_preview_new,.js_cover_preview_square';

function backgroundSource(element: HTMLElement): string | null {
  return /^url\(["']?(.*?)["']?\)$/u.exec(getComputedStyle(element).backgroundImage)?.[1] || null;
}

function uploadedSource(source: string): boolean {
  try {
    const url = new URL(source);
    return url.protocol === 'https:' && (url.hostname === 'mmbiz.qpic.cn' || url.hostname.endsWith('.qpic.cn'));
  } catch {
    return false;
  }
}

function previews(): HTMLElement[] {
  return [...(document.querySelector(coverRoot)?.querySelectorAll<HTMLElement>(coverPreviews) ?? [])].filter(isVisible);
}

export function hasWechatArticleCover(): boolean {
  return previews().some((element) => Boolean(backgroundSource(element)));
}

export async function fillWechatArticleCover(file: File): Promise<boolean> {
  const root = document.querySelector<HTMLElement>(coverRoot);
  if (!root || !isVisible(root) || hasWechatArticleCover()) return false;
  // Dropping one file initializes WeChat's cover uploader and its crop dialog.
  const transfer = new DataTransfer();
  transfer.items.add(file);
  for (const type of ['dragenter', 'dragover', 'drop']) {
    root.dispatchEvent(
      new DragEvent(type, {
        dataTransfer: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }
  const deadline = Date.now() + 90_000;
  let confirmed = false;
  let selectedFile = false;
  const loaded = new Map<string, HTMLImageElement>();
  while (Date.now() < deadline && root.isConnected) {
    const dialogs = [...document.querySelectorAll<HTMLElement>('.weui-desktop-dialog')].filter(
      (dialog) => isVisible(dialog) && dialog.querySelector('.cover-edit-new'),
    );
    if (dialogs.length > 1) return false;
    const dialog = dialogs[0];
    if (!dialog && !selectedFile) {
      // A synthetic drop initializes the lazy uploader without populating its
      // picker on some WeChat versions. Select the file once it is ready, but
      // never enqueue it again while an upload is already running.
      const inputs = [...document.querySelectorAll<HTMLInputElement>('#js_description_area input[type="file"]')].filter(
        (input) => !input.disabled,
      );
      const uploading = [...root.querySelectorAll<HTMLElement>('.js_cover_loading')].some(isVisible);
      if (!uploading && inputs.length === 1) {
        selectedFile = true;
        if (!setMediaFiles(inputs[0]!, [file])) return false;
      }
    }
    if (dialog && !confirmed) {
      const image = dialog.querySelector<HTMLImageElement>('.crop-img');
      const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('.weui-desktop-dialog__ft button')].filter(
        (button) => isVisible(button) && !button.disabled && button.textContent?.trim() === '确认',
      );
      if (image && uploadedSource(image.src) && image.complete && image.naturalWidth > 0 && buttons.length === 1) {
        // Accept the site's default crops for the message list and share card.
        buttons[0]!.click();
        confirmed = true;
      }
    }
    if (confirmed && !dialog) {
      const covers = previews();
      const primary = root.querySelector<HTMLElement>('.js_cover_preview_new');
      if (
        primary &&
        covers.includes(primary) &&
        covers.every((element) => {
          const source = backgroundSource(element);
          if (!source || !uploadedSource(source)) return false;
          let image = loaded.get(source);
          if (!image) {
            image = new Image();
            image.src = source;
            loaded.set(source, image);
          }
          return image.complete && image.naturalWidth > 0;
        })
      )
        return true;
    }
    if (
      [...document.querySelectorAll<HTMLElement>('.weui-desktop-toast,.weui-desktop-toptips')].some(
        (element) => isVisible(element) && /上传失败|上传出错|文件过大|图片太大/.test(element.textContent ?? ''),
      )
    )
      return false;
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
  return false;
}

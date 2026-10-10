import type { PetalWindow } from '@/main/desktop-petals/petal-windows';

/** Feedback follows the same native flower hit test used by the drop. */
export class PetalCollectionPreview {
  private target?: PetalWindow;
  private source?: PetalWindow;
  private detach?: () => void;
  active(entry?: PetalWindow) {
    return Boolean(entry && this.target === entry);
  }
  update(source: PetalWindow, target?: PetalWindow) {
    if (this.source === source && this.target === target) return;
    const previous = this.target;
    this.detach?.();
    const clear = () => this.clear(source);
    source.window.once('closed', clear);
    source.window.once('hide', clear);
    this.detach = () => {
      source.window.removeListener('closed', clear);
      source.window.removeListener('hide', clear);
    };
    this.source = source;
    this.target = target;
    if (previous && !previous.window.isDestroyed()) previous.window.webContents.send('desktop-petals:changed');
    if (target && !target.window.isDestroyed()) {
      target.window.moveTop();
      target.window.webContents.send('desktop-petals:changed');
    }
  }
  clear(source: PetalWindow) {
    if (this.source !== source) return;
    this.update(source);
    this.detach?.();
    this.detach = undefined;
    this.source = undefined;
  }
}

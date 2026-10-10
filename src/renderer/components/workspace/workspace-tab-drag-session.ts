import type { WorkspaceRuntimeTab, WorkspaceTabPlacement } from '@/renderer/components/workspace/workspace-state';
import {
  TAB_DRAG_DELAY,
  TAB_DRAG_THRESHOLD,
  clearTabPreview,
  containsPoint,
  previewTabPositions,
  scrollTabDragZone,
  tabDragExtent,
  tabDragTarget,
  tabDragScrollDirection,
  tabInsertionRect,
  tabItems,
  type TabDragTarget,
} from '@/renderer/components/workspace/workspace-tab-drag-geometry';

export interface TabDragView {
  id: string;
  rect: DOMRect;
  pinned: boolean;
  iconOnly: boolean;
  verticalLabel: boolean;
  phase: 'drag' | 'settle';
  targetPinned: boolean | null;
}

export interface TabDragEnvironment {
  root(): HTMLElement | null;
  list(): HTMLElement | null;
  ghost(): HTMLElement | null;
  indicator(): HTMLElement | null;
  valid(): boolean;
  view(value: TabDragView | null): void;
  openPinned(value: boolean): void;
  commit(id: string, placement: WorkspaceTabPlacement): void;
  capture(id: string): void;
  restoreFocus(node: HTMLElement | null, id: string): void;
}

/** One pointer gesture owns its preview, listeners, scrolling and cancellation. */
export class WorkspaceTabDragSession {
  private x: number;
  private y: number;
  private frame = 0;
  private lastTime = 0;
  private enteredAt = 0;
  private region: boolean | null = null;
  private overflowSince = 0;
  private scrollingSince = 0;
  private scrollZone: HTMLElement | null = null;
  private scrollDirection = 0;
  private target: TabDragTarget | null = null;
  private targetPinned: boolean | null = null;
  private lastPinnedAt = 0;
  private started = false;
  private done = false;
  private settlement: 'commit' | 'cancel' | null = null;
  private animations: Animation[] = [];
  private hiddenDestination: HTMLElement | null = null;
  private reduced = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  private focus: HTMLElement | null;
  private initialSize: string;
  private pointerId: number;
  private sourceRect: DOMRect;
  private iconOnly: boolean;
  private verticalLabel: boolean;
  hasSettled = false;

  constructor(
    private env: TabDragEnvironment,
    private tab: WorkspaceRuntimeTab,
    private orderKey: string,
    private startX: number,
    private startY: number,
    source: HTMLElement,
    event: PointerEvent,
  ) {
    this.x = startX;
    this.y = startY;
    this.pointerId = event.pointerId;
    this.sourceRect = source.getBoundingClientRect();
    this.iconOnly = source.closest('[data-workspace-tab-zone="pinned"]') !== null;
    this.verticalLabel = source.closest('[data-workspace-tab-zone="regular"][data-tab-axis="vertical"]') !== null;
    this.focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.initialSize = `${window.innerWidth}:${window.innerHeight}`;
    document.addEventListener('pointermove', this.move, { capture: true, passive: false });
    document.addEventListener('pointerup', this.release, true);
    document.addEventListener('pointercancel', this.cancel, true);
    document.addEventListener('keydown', this.key, true);
    document.addEventListener('contextmenu', this.cancel, true);
    window.addEventListener('blur', this.cancel);
    window.addEventListener('resize', this.resize);
    document.addEventListener('pointerout', this.leaveWindow, true);
  }

  get dragging() {
    return this.started && !this.done && this.settlement === null;
  }
  get settling() {
    return this.settlement !== null;
  }
  isValid() {
    return this.env.valid();
  }

  private roots() {
    return [this.env.root(), this.env.list()];
  }
  private zones() {
    const root = this.env.root();
    const list = this.env.list();
    return [...(root?.querySelectorAll<HTMLElement>('[data-workspace-tab-zone]') ?? []), ...(list ? [list] : [])];
  }

  private move = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    if (event.buttons !== 1) {
      this.cancel();
      return;
    }
    this.x = event.clientX;
    this.y = event.clientY;
    if (!this.started && Math.hypot(this.x - this.startX, this.y - this.startY) >= TAB_DRAG_THRESHOLD) {
      this.started = true;
      this.publishView('drag', null);
      this.frame = requestAnimationFrame(this.tick);
    }
    if (this.started) event.preventDefault();
  };

  private release = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    this.x = event.clientX;
    this.y = event.clientY;
    if (this.started) this.updateTarget(performance.now());
    this.finish(Boolean(this.target) && this.env.valid());
  };

  private key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      if (this.started) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      this.cancel();
    } else if (this.started && !['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) {
      this.cancel();
    }
  };

  cancel = () => this.finish(false);
  private resize = () => {
    if (this.settlement) this.dispose();
    else this.cancel();
  };
  private leaveWindow = (event: PointerEvent) => {
    if (event.pointerId === this.pointerId && event.relatedTarget === null) this.cancel();
  };

  private publishView(phase: TabDragView['phase'], targetPinned: boolean | null) {
    this.env.view({
      id: this.tab.id,
      pinned: Boolean(this.tab.pinned),
      iconOnly: this.iconOnly,
      verticalLabel:
        phase === 'settle' && this.settlement === 'commit'
          ? Boolean(this.target && !this.target.pinned && this.target.vertical)
          : this.verticalLabel,
      rect: this.sourceRect,
      phase,
      targetPinned,
    });
  }

  private tick = (time: number) => {
    if (this.done || this.settlement) return;
    if (
      !this.env.valid() ||
      `${window.innerWidth}:${window.innerHeight}` !== this.initialSize ||
      document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]')
    ) {
      this.cancel();
      return;
    }
    if (this.started) {
      this.updateTarget(time);
      this.paint();
      if (this.scrollZone && time - this.scrollingSince >= 120) {
        scrollTabDragZone(this.scrollZone, this.x, this.y, this.lastTime ? time - this.lastTime : 16);
      }
    }
    this.lastTime = time;
    this.frame = requestAnimationFrame(this.tick);
  };

  private updateTarget(time: number) {
    const underPointer = document.elementFromPoint(this.x, this.y);
    const zone = underPointer?.closest<HTMLElement>('[data-workspace-tab-zone]') ?? null;
    const owned =
      zone && this.zones().includes(zone) && containsPoint(zone.getBoundingClientRect(), this.x, this.y) ? zone : null;
    const overflow = underPointer?.closest('[data-workspace-pinned-overflow]');
    if (overflow && this.env.root()?.contains(overflow)) {
      if (!this.overflowSince) this.overflowSince = time;
      if (time - this.overflowSince >= TAB_DRAG_DELAY) this.env.openPinned(true);
    } else this.overflowSince = 0;
    const pinned = owned ? owned.dataset.workspaceTabZone !== 'regular' : null;
    if (pinned) this.lastPinnedAt = time;
    const region = pinned === null && this.region === true && time - this.lastPinnedAt < 120 ? true : pinned;
    if (region !== this.region) {
      this.region = region;
      this.enteredAt = time;
    }
    const ready = pinned !== null && (pinned === Boolean(this.tab.pinned) || time - this.enteredAt >= TAB_DRAG_DELAY);
    this.target = owned && ready && !overflow ? tabDragTarget(owned, this.tab.id, this.x, this.y, this.target) : null;
    const nextPinned = ready && pinned !== Boolean(this.tab.pinned) ? pinned : null;
    if (nextPinned !== this.targetPinned) {
      this.targetPinned = nextPinned;
      this.publishView('drag', nextPinned);
    }
    const direction = tabDragScrollDirection(owned, this.x, this.y);
    if (owned !== this.scrollZone || direction !== this.scrollDirection) {
      this.scrollZone = owned;
      this.scrollDirection = direction;
      this.scrollingSince = time;
    }
  }

  private paint() {
    const ghost = this.env.ghost();
    if (ghost) ghost.style.transform = `translate(${this.x - this.startX}px, ${this.y - this.startY}px)`;
    const indicator = this.env.indicator();
    if (indicator) {
      indicator.style.display = this.target ? 'block' : 'none';
      if (this.target) {
        const rect = tabInsertionRect(this.target, this.tab.id);
        Object.assign(indicator.style, {
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        });
      }
    }
    const extent = this.target ? tabDragExtent(this.target, this.sourceRect, Boolean(this.tab.pinned)) : 0;
    for (const zone of this.zones()) {
      const target = this.target?.zone === zone ? this.target : null;
      // Without a valid target, retain the source slot rather than collapsing it.
      if (!this.target) {
        clearTabPreview([zone]);
        tabItems(zone)
          .find((node) => node.dataset.workspaceTabItem === this.tab.id)
          ?.style.setProperty('opacity', '0');
      } else previewTabPositions(zone, this.tab.id, target, extent, this.reduced);
    }
  }

  private detach() {
    cancelAnimationFrame(this.frame);
    document.removeEventListener('pointermove', this.move, true);
    document.removeEventListener('pointerup', this.release, true);
    document.removeEventListener('pointercancel', this.cancel, true);
    document.removeEventListener('keydown', this.key, true);
    document.removeEventListener('contextmenu', this.cancel, true);
    window.removeEventListener('blur', this.cancel);
    document.removeEventListener('pointerout', this.leaveWindow, true);
  }

  private finish(commit: boolean) {
    if (this.done || this.settlement) return;
    this.detach();
    if (!this.started) {
      this.dispose();
      return;
    }
    suppressDragClick();
    this.env.indicator()?.style.setProperty('display', 'none');
    this.env.capture(this.tab.id);
    clearTabPreview(this.roots());
    this.settlement = commit && this.target ? 'commit' : 'cancel';
    if (this.settlement === 'commit' && this.target) {
      this.env.commit(this.tab.id, {
        pinned: this.target.pinned,
        beforeId: this.target.beforeId,
        orderKey: this.orderKey,
      });
    }
    this.publishView('settle', null);
  }

  /** Called after React applies the final layout, never from an animation completion. */
  settle() {
    if (!this.settlement || this.done || this.animations.length) return;
    this.hasSettled = true;
    this.env.restoreFocus(this.focus, this.tab.id);
    const root = this.env.root();
    const list = this.env.list();
    const destination =
      [this.target?.zone === list ? list : root, root, list]
        .flatMap((node) => (node ? tabItems(node) : []))
        .find((node) => node.dataset.workspaceTabItem === this.tab.id) ??
      root?.querySelector<HTMLElement>('[data-workspace-pinned-overflow]');
    const ghost = this.env.ghost();
    if (!destination || !ghost || !ghost.animate || this.reduced) {
      this.complete();
      return;
    }
    const rect = destination.getBoundingClientRect();
    const container = destination.closest<HTMLElement>('[data-workspace-tab-zone]');
    if (
      container &&
      !containsPoint(container.getBoundingClientRect(), rect.left + rect.width / 2, rect.top + rect.height / 2)
    ) {
      this.complete();
      return;
    }
    const deltaX = this.x - this.startX;
    const deltaY = this.y - this.startY;
    const near = Math.hypot(rect.left - this.sourceRect.left - deltaX, rect.top - this.sourceRect.top - deltaY) < 400;
    if (!near) {
      this.complete();
      return;
    }
    this.hiddenDestination = destination;
    destination.style.opacity = '0';
    const pinned = destination.closest('[data-workspace-tab-zone="pinned"]') !== null;
    const verticalLabel = destination.closest('[data-workspace-tab-zone="regular"][data-tab-axis="vertical"]') !== null;
    const animation = ghost.animate(
      [
        {
          transform: `translate(${deltaX}px, ${deltaY}px)`,
          width: `${this.sourceRect.width}px`,
          height: `${this.sourceRect.height}px`,
        },
        {
          transform: `translate(${rect.left - this.sourceRect.left}px, ${rect.top - this.sourceRect.top}px)`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          paddingLeft: pinned ? '9px' : verticalLabel ? '4px' : '12px',
          paddingRight: pinned ? '9px' : verticalLabel ? '4px' : '12px',
          paddingTop: verticalLabel ? '8px' : '0px',
          paddingBottom: verticalLabel ? '8px' : '0px',
          gap: pinned ? '0px' : '8px',
        },
      ],
      { duration: this.settlement === 'cancel' ? 120 : 180, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'forwards' },
    );
    this.animations.push(animation);
    const label = ghost.querySelector<HTMLElement>('[data-tab-drag-label]');
    if (label?.animate)
      this.animations.push(
        label.animate([{ opacity: this.iconOnly ? 0 : 1 }, { opacity: pinned ? 0 : 1 }], {
          duration: 100,
          fill: 'forwards',
        }),
      );
    animation.onfinish = () => this.complete();
  }

  private complete() {
    this.dispose();
  }

  dispose() {
    this.done = true;
    this.detach();
    window.removeEventListener('resize', this.resize);
    this.animations.forEach((animation) => {
      animation.onfinish = null;
      animation.cancel();
    });
    this.animations = [];
    this.hiddenDestination?.style.removeProperty('opacity');
    clearTabPreview(this.roots());
    this.env.view(null);
    this.env.openPinned(false);
  }
}

function suppressDragClick() {
  const stop = (event: MouseEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    cleanup();
  };
  const cleanup = () => {
    document.removeEventListener('click', stop, true);
    document.removeEventListener('pointerdown', cleanup, true);
    window.clearTimeout(timer);
  };
  const timer = window.setTimeout(cleanup, 350);
  document.addEventListener('click', stop, true);
  document.addEventListener('pointerdown', cleanup, true);
}

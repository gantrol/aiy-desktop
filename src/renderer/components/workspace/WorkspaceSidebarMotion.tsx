import { Component, createRef, type CSSProperties, type ReactNode } from 'react';
import './workspace-sidebar-motion.css';

interface Props {
  tabId: string;
  hasSidebar: boolean;
  navigationKey: string;
  surfaceKey: string;
  width: number;
  animate: boolean;
  children: ReactNode;
}

interface SidebarSnapshot {
  element: HTMLElement;
  bounds: DOMRect;
  scroll: Array<{ top: number; left: number }>;
}

interface MotionState {
  navigationKey: string;
  width: number;
  requested: boolean;
  animate: boolean;
  initialized: boolean;
}

function visibleSidebar(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-workspace-sidebar-body]')).find(
    (element) => !element.closest('[inert], [hidden]') && element.getBoundingClientRect().width > 0,
  );
}

/** Only departing sidebar paint is retained; navigation, focus and editing are never delayed. */
export class WorkspaceSidebarMotion extends Component<Props, MotionState> {
  private root = createRef<HTMLDivElement>();
  private exit: HTMLDivElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  state: MotionState = {
    navigationKey: this.props.navigationKey,
    width: this.props.width,
    requested: this.props.animate,
    animate: false,
    initialized: this.props.width > 0,
  };

  static getDerivedStateFromProps(props: Props, state: MotionState): MotionState | null {
    if (props.width === state.width && props.navigationKey === state.navigationKey && props.animate === state.requested)
      return null;
    return {
      navigationKey: props.navigationKey,
      width: props.width,
      requested: props.animate,
      initialized: state.initialized || props.width > 0,
      animate: props.width > 0 && state.initialized && (props.animate || props.navigationKey !== state.navigationKey),
    };
  }

  getSnapshotBeforeUpdate(previous: Props): SidebarSnapshot[] | null {
    const root = this.root.current;
    if (!root || previous.surfaceKey === this.props.surfaceKey) return null;
    this.clearExit();
    // A retained destination sidebar replaces this paint; cloning it would only be discarded after commit.
    // Same-tab navigation may still carry the departing page's registration, so only trust another tab.
    if (previous.tabId !== this.props.tabId && this.props.hasSidebar) return null;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null;
    const sidebar = visibleSidebar(root);
    if (!sidebar) return null;
    const header = root.querySelector<HTMLElement>('[data-workspace-sidebar-header]:not([hidden])');
    return [sidebar, header].flatMap((element) => {
      if (!element) return [];
      const bounds = element.getBoundingClientRect();
      const clone = element.cloneNode(true) as HTMLElement;
      // Preserve the visible scroll positions without mounting another React tree or editor session.
      const source = [element, ...element.querySelectorAll<HTMLElement>('*')];
      const target = [clone, ...clone.querySelectorAll<HTMLElement>('*')];
      target.forEach((node) => {
        node.removeAttribute('id');
        node.removeAttribute('data-workspace-sidebar-body');
        node.removeAttribute('data-workspace-sidebar-tab-id');
        node.removeAttribute('data-workspace-sidebar-header');
      });
      return [
        { element: clone, bounds, scroll: source.map((node) => ({ top: node.scrollTop, left: node.scrollLeft })) },
      ];
    });
  }

  componentDidUpdate(_previous: Props, _state: unknown, snapshot: SidebarSnapshot[] | null) {
    if (!snapshot && !this.exit) return;
    const root = this.root.current;
    if (!root) return;
    if (visibleSidebar(root)) {
      this.clearExit();
      return;
    }
    if (!snapshot?.length) return;
    const origin = root.getBoundingClientRect();
    const exit = document.createElement('div');
    exit.className = 'workspace-sidebar-exit pointer-events-none absolute inset-0 z-40 overflow-hidden';
    exit.inert = true;
    exit.setAttribute('aria-hidden', 'true');
    snapshot.forEach(({ element, bounds }) => {
      Object.assign(element.style, {
        position: 'absolute',
        left: `${bounds.left - origin.left}px`,
        top: `${bounds.top - origin.top}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        margin: '0',
      });
      exit.append(element);
    });
    root.append(exit);
    snapshot.forEach(({ element, scroll }) => {
      [element, ...element.querySelectorAll<HTMLElement>('*')].forEach((node, index) => {
        node.scrollTop = scroll[index].top;
        node.scrollLeft = scroll[index].left;
      });
    });
    this.exit = exit;
    this.timer = setTimeout(() => this.clearExit(), 120);
  }

  componentWillUnmount() {
    this.clearExit();
  }

  private clearExit() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.exit?.remove();
    this.exit = null;
  }

  render() {
    const { children, width } = this.props;
    return (
      <div
        ref={this.root}
        className="workspace-sidebar-frame relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden"
        data-sidebar-motion={this.state.animate}
        style={{ '--workspace-sidebar-width': `${width}px` } as CSSProperties}
      >
        {children}
      </div>
    );
  }
}

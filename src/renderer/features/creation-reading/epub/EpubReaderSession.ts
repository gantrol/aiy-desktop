import { Book, EpubCFI, type Contents, type Location, type NavItem, type Rendition } from 'epubjs';
import type Section from 'epubjs/types/section';
import type { ReadingPosition } from '@/shared/contracts/creation-reading';
import type {
  ReadingReveal,
  ReadingSelection,
  ReadingViewportPosition,
} from '@/renderer/features/creation-reading/ReadingText';
import { EpubPublication } from '@/renderer/features/creation-reading/epub/EpubPublication';

export interface EpubChapter {
  href: string;
  label: string;
  depth: number;
}
export interface EpubReaderState {
  chapters: EpubChapter[];
  chapter: string;
  fontSize: number;
}
interface ReaderCallbacks {
  state(value: EpubReaderState): void;
  select(value: ReadingSelection | null): void;
  position(value: ReadingViewportPosition): void;
  failed(reason: unknown): void;
  locationMissing(): void;
  resourceMissing(): void;
}

async function deadline<T>(operation: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('EPUB_UNAVAILABLE')), 30_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class EpubReaderSession {
  #publication: EpubPublication;
  #book: Book;
  #rendition: Rendition | undefined;
  #disposed = false;
  #fontSize: number;
  #chapters: EpubChapter[] = [];
  #currentCfi: string | undefined;
  #currentHref = '';
  #queue: Promise<unknown> = Promise.resolve();
  #moving = false;
  #selection: ReadingSelection | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: ReaderCallbacks,
    position?: ReadingPosition,
  ) {
    this.#fontSize = position?.fontSize ?? 18;
    this.#publication = new EpubPublication(() => {
      if (!this.#disposed) callbacks.resourceMissing();
    });
    this.#book = new Book({ requestMethod: this.#publication.request, replacements: 'none' });
  }

  async open(bytes: Uint8Array, position?: ReadingPosition) {
    const path = await this.#publication.open(bytes);
    if (this.#disposed) return;
    await deadline(this.#book.open(path, 'opf'));
    await deadline(this.#book.ready);
    if (this.#disposed) return;
    this.#readChapters();
    const options = {
      width: '100%',
      height: '100%',
      manager: 'continuous',
      flow: 'scrolled',
      spread: 'none',
      allowScriptedContent: false,
      allowPopups: false,
      // Write into the sandboxed initial document; no frame navigation or broader app CSP is needed.
      method: 'write',
    };
    const rendition = this.#book.renderTo(this.container, options);
    this.#rendition = rendition;
    const style = getComputedStyle(this.container);
    rendition.themes.default({
      html: { color: style.color, 'background-color': style.backgroundColor, 'scroll-behavior': 'auto' },
      body: { 'line-height': '1.65', 'overflow-wrap': 'break-word' },
      img: { 'max-width': '100%', height: 'auto' },
      'img[data-aiy-epub-image]': { 'min-height': '1em' },
      a: { color: 'inherit', 'text-decoration': 'underline' },
      ':focus-visible': { outline: '2px solid currentColor', 'outline-offset': '2px' },
    });
    rendition.themes.fontSize(this.#fontSize + 'px');
    rendition.hooks.content.register((contents: Contents) => this.#connectContents(contents));
    rendition.hooks.unloaded.register((view: { section: Section; contents?: Contents }) => {
      if (view.contents) this.#publication.releaseImages(view.contents.document);
      view.section.unload();
    });
    rendition.on('relocated', (location: Location) => {
      if (this.#disposed || this.#moving || !location.start?.cfi) return;
      this.#currentCfi = location.start.cfi;
      this.#currentHref = this.#relative(location.start.href) ?? '';
      this.#publish();
    });
    rendition.on('selected', (cfi: string, contents: Contents) => {
      if (this.#disposed || !contents.document.defaultView?.frameElement?.isConnected) return;
      try {
        const text = contents.range(cfi).toString();
        const section = this.#book.spine.get(contents.sectionIndex);
        this.#selection = text.trim() ? { text, location: { epubCfi: cfi, chapter: this.#label(section.href) } } : null;
        this.callbacks.select(this.#selection);
      } catch {
        this.#selection = null;
        this.callbacks.select(null);
      }
    });
    rendition.on('displayError', (reason: unknown) => {
      if (!this.#disposed) this.callbacks.failed(reason);
    });
    const target = position?.epubCfi;
    try {
      await deadline(rendition.display(target));
    } catch (reason) {
      if (!target || this.#disposed) throw reason;
      this.callbacks.locationMissing();
      await deadline(rendition.display());
    }
    if (!this.#disposed) this.#publish();
  }

  #relative(href: string) {
    const target = this.#publication.resolve(href);
    return target ? this.#book.path.relative(target.href) : null;
  }

  #readChapters() {
    const visit = (items: NavItem[], depth: number) => {
      if (depth > 12) return;
      for (const item of items) {
        if (this.#chapters.length >= 1000) return;
        const href = this.#relative(item.href);
        if (href) this.#chapters.push({ href, label: item.label.trim().slice(0, 1000), depth });
        if (item.subitems) visit(item.subitems, depth + 1);
      }
    };
    visit(this.#book.navigation.toc, 0);
    if (!this.#chapters.length)
      this.#book.spine.each((section: Section) => {
        if (section.linear) this.#chapters.push({ href: section.href, label: section.idref, depth: 0 });
      });
  }

  #label(href: string) {
    const relative = this.#relative(href)?.split('#')[0];
    return this.#chapters.find((chapter) => chapter.href.split('#')[0] === relative)?.label ?? '';
  }

  #publish() {
    if (this.#disposed) return;
    this.callbacks.state({
      chapters: this.#chapters,
      chapter: this.#label(this.#currentHref),
      fontSize: this.#fontSize,
    });
    if (this.#currentCfi)
      this.callbacks.position({ view: 'EPUB', scrollTop: 0, epubCfi: this.#currentCfi, fontSize: this.#fontSize });
  }

  #connectContents(contents: Contents) {
    const doc = contents.document;
    this.#publication.observeImages(doc, this.#book.spine.get(contents.sectionIndex).href);
    const frame = doc.defaultView?.frameElement;
    frame?.setAttribute('title', this.#label(this.#book.spine.get(contents.sectionIndex).href));
    doc.body.tabIndex = 0;
    doc.addEventListener('selectionchange', () => {
      if (!this.#disposed && !this.#moving && doc.hasFocus() && doc.getSelection()?.isCollapsed) {
        this.#selection = null;
        this.callbacks.select(null);
      }
    });
    doc.addEventListener(
      'click',
      (event) => {
        const target = event.target as Element | null;
        const href = target?.nodeType === 1 ? target.closest('a[href]')?.getAttribute('href') : null;
        if (!href) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.navigate(href);
      },
      true,
    );
    doc.addEventListener('keydown', (event) => {
      if ((event.key === 'PageDown' || event.key === 'PageUp') && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        this.page(event.key === 'PageDown' ? 1 : -1);
      }
    });
  }

  #run(action: (rendition: Rendition) => Promise<unknown>, clearSelection = true) {
    this.#queue = this.#queue
      .then(async () => {
        if (this.#disposed || !this.#rendition) return;
        if (clearSelection) {
          this.#selection = null;
          this.callbacks.select(null);
        }
        await deadline(action(this.#rendition));
      })
      .catch((reason: unknown) => {
        if (!this.#disposed) this.callbacks.failed(reason);
      });
    return this.#queue;
  }

  navigate(href: string) {
    const relative = this.#relative(href);
    if (!relative) {
      this.callbacks.locationMissing();
      return;
    }
    void this.#run(async (rendition) => {
      await rendition.display(relative);
      this.#focus(relative);
    });
  }

  page(direction: number) {
    void this.#run((rendition) => (direction > 0 ? rendition.next() : rendition.prev()));
  }

  resize(width: number, height: number) {
    if (width < 1 || height < 1) return;
    void this.#run(async (rendition) => {
      const cfi = this.#selection?.location.epubCfi ?? this.#currentCfi;
      this.#moving = true;
      try {
        rendition.resize(width, height);
        if (cfi) await rendition.display(cfi);
        this.#restoreSelection(rendition);
      } finally {
        this.#moving = false;
      }
    }, false);
  }

  fontSize(value: number) {
    this.#fontSize = Math.max(12, Math.min(32, value));
    this.#publish();
    void this.#run(async (rendition) => {
      const cfi = this.#selection?.location.epubCfi ?? this.#currentCfi;
      this.#moving = true;
      try {
        rendition.themes.fontSize(this.#fontSize + 'px');
        if (cfi) await rendition.display(cfi);
        this.#restoreSelection(rendition);
      } finally {
        this.#moving = false;
      }
    }, false);
  }

  #restoreSelection(rendition: Rendition) {
    const cfi = this.#selection?.location.epubCfi;
    if (!cfi || this.#disposed) return;
    try {
      const range = rendition.getRange(cfi);
      if (!range || range.toString() !== this.#selection?.text) return;
      const selection = range.startContainer.ownerDocument?.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    } catch {
      /* The selected section may have scrolled out of the rendered window. */
    }
  }

  #focus(target?: string) {
    if (this.#disposed || !this.#rendition) return;
    const index = this.#book.spine.get(target?.startsWith('epubcfi(') ? target : target?.split('#')[0])?.index;
    // The package's types describe a single Contents; the runtime returns the rendered window.
    const contents = this.#rendition.getContents() as unknown as Contents[];
    const current = contents.find((item) => item.sectionIndex === index) ?? contents[0];
    current?.document.body.focus({ preventScroll: true });
  }

  reveal(reveal: ReadingReveal) {
    return this.#run(async (rendition) => {
      const cfi = reveal.location.epubCfi ?? reveal.position?.epubCfi;
      if (reveal.quote && !cfi) {
        this.callbacks.locationMissing();
        return;
      }
      if (reveal.position?.fontSize) {
        this.#fontSize = reveal.position.fontSize;
        rendition.themes.fontSize(this.#fontSize + 'px');
      }
      try {
        if (cfi) {
          const parsed = new EpubCFI(cfi);
          if (!this.#book.spine.get(parsed.spinePos)) throw new Error('EPUB_LOCATION');
        }
        await rendition.display(cfi);
        if (this.#disposed) return;
        this.#focus(cfi);
        if (reveal.quote && cfi) {
          const range = rendition.getRange(cfi);
          if (!range || range.toString() !== reveal.quote) throw new Error('EPUB_LOCATION');
          const doc = range.startContainer.ownerDocument;
          doc?.body.focus({ preventScroll: true });
          const selection = doc?.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          this.#selection = { text: reveal.quote, location: reveal.location };
          this.callbacks.select(this.#selection);
        }
        this.#publish();
      } catch {
        if (!this.#disposed) this.callbacks.locationMissing();
      }
    });
  }

  destroy() {
    this.#disposed = true;
    this.#publication.destroy();
    this.#book.destroy();
  }
}

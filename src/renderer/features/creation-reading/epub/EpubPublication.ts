import DOMPurify from 'dompurify';
import { EpubArchive } from '@/renderer/features/creation-reading/epub/EpubArchive';
import { epubLimits } from '@/renderer/features/creation-reading/epub/epubArchiveProtocol';
import { epubStylesheet, rewriteEpubCss } from '@/renderer/features/creation-reading/epub/epubStyles';

const origin = 'https://epub.invalid';
const policy =
  "default-src 'none'; script-src 'none'; img-src blob:; style-src 'unsafe-inline'; font-src blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const assetTypes: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
};
const allowedTypes = new Set(Object.values(assetTypes));

function xml(text: string, html = false) {
  const doc = new DOMParser().parseFromString(text, html ? 'application/xhtml+xml' : 'application/xml');
  if (doc.querySelector('parsererror') || doc.querySelectorAll('*').length > 30_000) throw new Error('EPUB_INVALID');
  return doc;
}

export class EpubPublication {
  readonly archive = new EpubArchive();
  packagePath = '';
  #types = new Map<string, string>();
  #metadata = new Map<string, Document>();
  #assets = new Map<string, Promise<string>>();
  #urls = new Set<string>();
  #fontKeys = new Map<string, Uint8Array>();
  #disposed = false;
  #documents = new Map<Document, () => void>();
  #imageQueue: Promise<unknown> = Promise.resolve();
  constructor(private readonly onMissingResource: () => void) {}

  resolve(href: string, from = this.packagePath) {
    if (/^[\s]*[a-z][\w+.-]*:/i.test(href) && !href.startsWith(origin + '/')) return null;
    try {
      const url = new URL(href, origin + '/' + from);
      if (url.origin !== origin || url.search || url.username || url.password) return null;
      const path = decodeURIComponent(url.pathname.slice(1));
      if (!this.archive.files.has(path)) return null;
      return { path, href: url.pathname + url.hash };
    } catch {
      return null;
    }
  }

  async open(bytes: Uint8Array) {
    await this.archive.open(bytes);
    const container = xml(await this.#text('META-INF/container.xml'));
    const rootfile = container.querySelector('rootfile[media-type="application/oebps-package+xml"]');
    const path = rootfile?.getAttribute('full-path');
    if (!path || !this.archive.files.has(path)) throw new Error('EPUB_INVALID');
    this.packagePath = path;
    const packageDocument = xml(await this.#text(path));
    if (!packageDocument.querySelector('spine itemref')) throw new Error('EPUB_INVALID');
    const items = [...packageDocument.querySelectorAll('manifest item')];
    const itemsById = new Map(items.map((item) => [item.id, item]));
    for (const item of items) {
      const target = this.resolve(item.getAttribute('href') ?? '', path);
      if (target) this.#types.set(target.path, item.getAttribute('media-type') ?? '');
    }
    await this.#readFontKeys(packageDocument);
    if (packageDocument.querySelector('meta[property="rendition:layout"]')?.textContent?.trim() === 'pre-paginated')
      throw new Error('EPUB_FIXED_LAYOUT');
    for (const reference of packageDocument.querySelectorAll('spine itemref')) {
      const item = itemsById.get(reference.getAttribute('idref') ?? '');
      if (
        !item ||
        !this.resolve(item.getAttribute('href') ?? '') ||
        item.getAttribute('media-type') !== 'application/xhtml+xml'
      )
        throw new Error('EPUB_INVALID');
      if (reference.getAttribute('properties')?.includes('rendition:layout-pre-paginated'))
        throw new Error('EPUB_FIXED_LAYOUT');
    }
    this.#metadata.set(path, packageDocument);
    const nav =
      items.find((item) => item.getAttribute('properties')?.split(/\s+/).includes('nav')) ??
      items.find((item) => item.id === packageDocument.querySelector('spine')?.getAttribute('toc'));
    if (nav) {
      const target = this.resolve(nav.getAttribute('href') ?? '');
      if (!target) throw new Error('EPUB_INVALID');
      const doc = await this.request(origin + '/' + target.path);
      for (const content of doc.querySelectorAll('content[src]')) {
        const link = this.resolve(content.getAttribute('src') ?? '', target.path);
        if (link) content.setAttribute('src', link.href);
      }
      this.#metadata.set(target.path, doc);
    }
    return origin + '/' + path;
  }

  #text = async (path: string, limit: number = epubLimits.document) => {
    const bytes = await this.archive.read(path, limit);
    const encoding =
      bytes[0] === 0xff && bytes[1] === 0xfe
        ? 'utf-16le'
        : bytes[0] === 0xfe && bytes[1] === 0xff
          ? 'utf-16be'
          : 'utf-8';
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  };

  async #readFontKeys(packageDocument: Document) {
    if (!this.archive.files.has('META-INF/encryption.xml')) return;
    const identifierId = packageDocument.documentElement.getAttribute('unique-identifier');
    const identifier = [...packageDocument.querySelectorAll('metadata identifier')]
      .find((item) => item.id === identifierId)
      ?.textContent?.replace(/[\x20\t\r\n]/g, '');
    const encryption = xml(await this.#text('META-INF/encryption.xml'));
    for (const entry of encryption.querySelectorAll('EncryptedData')) {
      const algorithm = entry.querySelector('EncryptionMethod')?.getAttribute('Algorithm');
      const target = this.resolve(entry.querySelector('CipherReference')?.getAttribute('URI') ?? '', '');
      if (
        !identifier ||
        algorithm !== 'http://www.idpf.org/2008/embedding' ||
        !target ||
        !/\.(woff2?|[ot]tf)$/i.test(target.path)
      )
        throw new Error('EPUB_ENCRYPTED');
      const key = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(identifier)));
      this.#fontKeys.set(target.path, key);
    }
  }

  request = async (href: string): Promise<Document> => {
    const target = this.resolve(href);
    if (!target) throw new Error('EPUB_RESOURCE_MISSING');
    const cached = this.#metadata.get(target.path);
    if (cached) return cached.cloneNode(true) as Document;
    if (this.#disposed) throw new Error('EPUB_UNAVAILABLE');
    const html = /\.(xhtml|html|htm)$/i.test(target.path) || this.#types.get(target.path) === 'application/xhtml+xml';
    const doc = xml(await this.#text(target.path), html);
    return html ? this.#prepareDocument(doc, target.path) : doc;
  };

  async #asset(href: string, from: string, ancestors: string[] = []): Promise<string> {
    const target = this.resolve(href, from);
    if (!target || ancestors.includes(target.path)) {
      this.onMissingResource();
      return '';
    }
    const path = target.path;
    const fragment = target.href.includes('#') ? target.href.slice(target.href.indexOf('#')) : '';
    const mime = assetTypes[path.split('.').pop()?.toLowerCase() ?? ''] || this.#types.get(path) || '';
    if (!allowedTypes.has(mime)) {
      this.onMissingResource();
      return '';
    }
    const existing = this.#assets.get(path);
    if (existing) return (await existing) + fragment;
    const promise = (async () => {
      let blob: Blob;
      if (mime === 'image/svg+xml') {
        const doc = xml(await this.#text(path));
        DOMPurify.sanitize(doc.documentElement, {
          IN_PLACE: true,
          USE_PROFILES: { svg: true, svgFilters: true },
          FORBID_TAGS: ['style', 'foreignObject'],
        });
        for (const element of doc.querySelectorAll('*')) {
          element.removeAttribute('style');
          for (const attribute of [...element.attributes]) {
            if (attribute.localName === 'href' && !attribute.value.startsWith('#')) {
              const value = ancestors.length < 4 ? await this.#asset(attribute.value, path, [...ancestors, path]) : '';
              element.setAttributeNS(attribute.namespaceURI, attribute.name, value);
            } else if (/url\s*\(/i.test(attribute.value) && !/^url\(['"]?#[\w.-]+['"]?\)$/i.test(attribute.value)) {
              element.removeAttributeNode(attribute);
            }
          }
        }
        blob = new Blob([new XMLSerializer().serializeToString(doc)], { type: mime });
      } else {
        const bytes = await this.archive.read(path);
        const key = this.#fontKeys.get(path);
        if (key)
          for (let index = 0; index < Math.min(1040, bytes.length); index++) bytes[index] ^= key[index % key.length];
        blob = new Blob([bytes], { type: mime });
      }
      if (this.#disposed) throw new Error('EPUB_UNAVAILABLE');
      const url = URL.createObjectURL(blob);
      this.#urls.add(url);
      return url;
    })();
    this.#assets.set(path, promise);
    return (await promise) + fragment;
  }

  async #css(href: string, from: string, ancestors: string[] = []): Promise<string> {
    const target = this.resolve(href, from);
    if (!target || ancestors.includes(target.path) || ancestors.length >= 8) {
      this.onMissingResource();
      return '';
    }
    return epubStylesheet(
      await this.#text(target.path, epubLimits.stylesheet),
      (url) => this.#asset(url, target.path),
      (url) => this.#css(url, target.path, [...ancestors, target.path]),
    );
  }

  async #prepareDocument(doc: Document, path: string) {
    DOMPurify.sanitize(doc.documentElement, {
      IN_PLACE: true,
      WHOLE_DOCUMENT: true,
      USE_PROFILES: { html: true, svg: true, mathMl: true },
      ADD_TAGS: ['link'],
      ADD_ATTR: ['epub:type'],
      FORBID_TAGS: [
        'script',
        'iframe',
        'object',
        'embed',
        'base',
        'meta',
        'form',
        'input',
        'button',
        'textarea',
        'select',
        'audio',
        'video',
        'source',
        'track',
        'foreignObject',
      ],
      FORBID_ATTR: ['srcset', 'ping', 'target', 'download', 'srcdoc', 'autofocus', 'data-aiy-epub-image'],
    });
    for (const element of doc.querySelectorAll('*')) {
      const tag = element.localName;
      if (tag === 'link') {
        if (element.getAttribute('rel') === 'stylesheet') {
          const style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style');
          style.textContent = await this.#css(element.getAttribute('href') ?? '', path);
          element.replaceWith(style);
        } else element.remove();
        continue;
      }
      if (tag === 'style')
        element.textContent = await epubStylesheet(
          element.textContent ?? '',
          (href) => this.#asset(href, path),
          (href) => this.#css(href, path),
        );
      if (element.hasAttribute('style'))
        element.setAttribute(
          'style',
          await rewriteEpubCss(element.getAttribute('style')!, (href) => this.#asset(href, path)),
        );
      for (const attr of [...element.attributes]) {
        if (attr.localName === 'href') {
          if (tag === 'a') {
            const target = this.resolve(attr.value, path);
            if (target) element.setAttribute('href', target.href);
            else element.removeAttributeNode(attr);
          } else if (!attr.value.startsWith('#'))
            element.setAttributeNS(attr.namespaceURI, attr.name, await this.#asset(attr.value, path));
        } else if (attr.localName === 'src') {
          if (tag === 'img') {
            element.setAttribute('data-aiy-epub-image', attr.value);
            element.removeAttribute('src');
          } else element.setAttribute('src', await this.#asset(attr.value, path));
        }
      }
    }
    const head = doc.querySelector('head');
    if (!head || !doc.querySelector('body')) throw new Error('EPUB_INVALID');
    const csp = doc.createElementNS('http://www.w3.org/1999/xhtml', 'meta');
    csp.setAttribute('http-equiv', 'Content-Security-Policy');
    csp.setAttribute('content', policy);
    head.prepend(csp);
    return doc;
  }

  observeImages(doc: Document, href: string) {
    for (const previous of this.#documents.keys()) {
      if (!previous.defaultView?.frameElement?.isConnected) this.releaseImages(previous);
    }
    this.releaseImages(doc);
    const path = this.resolve(href)?.path;
    if (!path || this.#disposed) return;
    let disposed = false;
    const queued = new WeakSet<Element>();
    const intersecting = new WeakSet<Element>();
    const load = (element: Element) => {
      if (queued.has(element)) return;
      queued.add(element);
      this.#imageQueue = this.#imageQueue
        .then(async () => {
          if (disposed || this.#disposed || !element.isConnected || (observer && !intersecting.has(element))) return;
          const source = element.getAttribute('data-aiy-epub-image');
          if (!source) return;
          const url = await this.#asset(source, path);
          if (!disposed && !this.#disposed && element.isConnected) {
            element.setAttribute('src', url);
            element.removeAttribute('data-aiy-epub-image');
            observer?.unobserve(element);
          }
        })
        .catch(() => {
          if (!disposed && !this.#disposed) this.onMissingResource();
        })
        .finally(() => queued.delete(element));
    };
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (entry.isIntersecting) {
                  intersecting.add(entry.target);
                  load(entry.target);
                } else intersecting.delete(entry.target);
              }
            },
            { rootMargin: '320px' },
          );
    for (const element of doc.querySelectorAll('img[data-aiy-epub-image]')) {
      if (observer) observer.observe(element);
      else load(element);
    }
    this.#documents.set(doc, () => {
      disposed = true;
      observer?.disconnect();
    });
  }

  releaseImages(doc: Document) {
    this.#documents.get(doc)?.();
    this.#documents.delete(doc);
  }

  destroy() {
    this.#disposed = true;
    for (const release of this.#documents.values()) release();
    this.#documents.clear();
    this.archive.destroy();
    for (const url of this.#urls) URL.revokeObjectURL(url);
    this.#urls.clear();
    this.#assets.clear();
    this.#metadata.clear();
    this.#types.clear();
    this.#fontKeys.clear();
  }
}

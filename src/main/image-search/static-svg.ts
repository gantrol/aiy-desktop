import { SaxesParser } from 'saxes';

/** Conservative self-contained SVG subset for librsvg. Never pass a file/base URL to the renderer. */
export function validateSearchSvg(bytes: Buffer, checkCancelled: () => void) {
  const parser = new SaxesParser({ xmlns: true });
  const reject = () => {
    throw new Error('STATIC_IMAGE_UNAVAILABLE');
  };
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let count = 0;
  let depth = 0;
  let embeddedBytes = 0;
  let styleDepth = 0;
  let css = '';
  const blocked = new Set([
    'script',
    'foreignobject',
    'animate',
    'animatetransform',
    'animatemotion',
    'set',
    'discard',
  ]);
  const checkCss = (value: string) => {
    // CSS escapes/comments can disguise resource references. Fragment paints are the only URLs accepted.
    if (/[\\@]|\/\*/u.test(value)) reject();
    if (/url\s*\(/iu.test(value.replace(/url\(\s*['"]?#[\w:.-]+['"]?\s*\)/giu, ''))) reject();
  };
  parser.on('doctype', reject);
  parser.on('processinginstruction', reject);
  parser.on('opentag', (tag) => {
    checkCancelled();
    if (++count > 50_000 || ++depth > 128) reject();
    if (count === 1 && (tag.local !== 'svg' || tag.uri !== 'http://www.w3.org/2000/svg')) reject();
    if (tag.uri !== 'http://www.w3.org/2000/svg' || blocked.has(tag.local.toLowerCase())) reject();
    if (tag.local === 'style') {
      styleDepth = depth;
      css = '';
    }
    for (const attr of Object.values(tag.attributes)) {
      const name = attr.local.toLowerCase();
      if (name.startsWith('on') || (attr.uri === 'http://www.w3.org/XML/1998/namespace' && name === 'base')) reject();
      if (name === 'href' || name === 'src') {
        const value = attr.value.trim();
        if (/^#[\w:.-]+$/u.test(value)) continue;
        if (tag.local !== 'image' || !/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\s]+$/iu.test(value)) reject();
        embeddedBytes += value.length;
        if (embeddedBytes > 16 * 1024 * 1024) reject();
      } else checkCss(attr.value);
    }
  });
  parser.on('closetag', () => {
    if (styleDepth === depth) {
      checkCss(css);
      styleDepth = 0;
    }
    depth--;
  });
  const textContent = (value: string) => {
    if (styleDepth) css += value;
  };
  parser.on('text', textContent);
  parser.on('cdata', textContent);
  for (let offset = 0; offset < text.length; offset += 64 * 1024) {
    checkCancelled();
    parser.write(text.slice(offset, offset + 64 * 1024));
  }
  parser.close();
  if (!count) reject();
}

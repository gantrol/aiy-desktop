const cssUrl = /url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s)]*))\s*\)/gi;

export async function rewriteEpubCss(text: string, resource: (href: string) => Promise<string>) {
  const matches = [...text.matchAll(cssUrl)];
  let output = '',
    offset = 0;
  for (const match of matches) {
    const href = (match[1] ?? match[2] ?? match[3] ?? '').replace(
      /\\([0-9a-f]{1,6})\s?|\\(.)/gi,
      (_all, hex: string, char: string) => {
        const point = hex ? Number.parseInt(hex, 16) : 0;
        return hex ? String.fromCodePoint(point > 0 && point <= 0x10ffff ? point : 0xfffd) : char;
      },
    );
    const url = href.startsWith('#') ? href : await resource(href);
    output += text.slice(offset, match.index) + 'url(' + JSON.stringify(url) + ')';
    offset = match.index! + match[0].length;
  }
  return output + text.slice(offset);
}

export async function epubStylesheet(
  text: string,
  resource: (href: string) => Promise<string>,
  imported: (href: string) => Promise<string>,
) {
  const sheet = new CSSStyleSheet();
  // Imports are resolved ourselves; constructed stylesheets intentionally discard @import.
  const imports: { href: string; media: string }[] = [];
  text = text.replace(
    /@import\s+(?:url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)|"([^"]+)"|'([^']+)')\s*([^;]*);/gi,
    (_all, quoted: string, single: string, bare: string, direct: string, directSingle: string, media: string) => {
      imports.push({ href: quoted ?? single ?? bare ?? direct ?? directSingle, media: media.trim() });
      return '';
    },
  );
  sheet.replaceSync(text);
  const rules = [...sheet.cssRules].map((rule) => rule.cssText).join('\n');
  let prefix = '';
  for (const { href, media } of imports) {
    const css = await imported(href);
    prefix += (media ? `@media ${media} {${css}}` : css) + '\n';
  }
  return prefix + (await rewriteEpubCss(rules, resource));
}

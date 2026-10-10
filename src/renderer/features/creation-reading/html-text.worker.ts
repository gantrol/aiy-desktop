import { parse, type DefaultTreeAdapterTypes } from 'parse5';

self.onmessage = (event: MessageEvent<string>) => {
  try {
    if (event.data.length > 4 * 1024 * 1024) throw new Error('HTML_LIMIT');
    const root = parse(event.data),
      parts: string[] = [];
    const stack: DefaultTreeAdapterTypes.Node[] = [root];
    const skip = new Set(['script', 'style', 'head', 'template', 'svg']);
    let count = 0;
    while (stack.length) {
      if (++count > 100_000) throw new Error('HTML_LIMIT');
      const node = stack.pop()!;
      if ('tagName' in node && skip.has(node.tagName)) continue;
      if (node.nodeName === '#text' && 'value' in node) parts.push(node.value);
      if ('tagName' in node && /^(p|div|h[1-6]|li|section|br|tr|blockquote)$/.test(node.tagName)) parts.push('\n');
      if ('childNodes' in node) for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push(node.childNodes[i]);
    }
    self.postMessage({
      text: parts
        .join('')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n/g, '\n\n')
        .trim(),
    });
  } catch {
    self.postMessage({ error: 'HTML_UNAVAILABLE' });
  }
};

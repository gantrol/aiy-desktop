interface MarkdownNode {
  type: string;
  value?: string;
  lang?: string;
  data?: { hProperties?: { className?: string[] } };
  children?: MarkdownNode[];
}

function looksLikeMath(value: string) {
  return /[\\_^{}=<>+*/]|^-|^[A-Za-z](?:_[A-Za-z0-9]+)?$/u.test(value.trim());
}

function inlineMathNodes(value: string): MarkdownNode[] | null {
  const matches = [...value.matchAll(/\$([^$\n]+)\$/gu)].filter((match) => looksLikeMath(match[1] ?? ''));
  if (!matches.length) return null;
  const nodes: MarkdownNode[] = [];
  let offset = 0;
  for (const match of matches) {
    const index = match.index ?? 0;
    if (index > offset) nodes.push({ type: 'text', value: value.slice(offset, index) });
    nodes.push({
      type: 'inlineCode',
      value: match[1] ?? '',
      data: { hProperties: { className: ['codex-math-inline'] } },
    });
    offset = index + match[0].length;
  }
  if (offset < value.length) nodes.push({ type: 'text', value: value.slice(offset) });
  return nodes;
}

function transformChildren(parent: MarkdownNode) {
  const children = parent.children;
  if (!children) return;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!child) continue;
    if (child.type === 'paragraph' && child.children?.length === 1 && child.children[0]?.type === 'text') {
      const block = /^\s*\$\$([\s\S]+)\$\$\s*$/u.exec(child.children[0].value ?? '');
      if (block) {
        children[index] = { type: 'code', lang: 'math', value: block[1]?.trim() ?? '' };
        continue;
      }
    }
    if (child.type === 'text' && child.value && !['code', 'inlineCode'].includes(parent.type)) {
      const replacement = inlineMathNodes(child.value);
      if (replacement) {
        children.splice(index, 1, ...replacement);
        index += replacement.length - 1;
        continue;
      }
    }
    if (!['code', 'inlineCode'].includes(child.type)) transformChildren(child);
  }
}

export function codexHistoryMarkdownMath() {
  return (tree: MarkdownNode) => transformChildren(tree);
}

/** A task title is a label, not a truncated Markdown document or attachment path. */
export function codexTaskTitle(title: string | null | undefined, body: string, fallback = 'Codex') {
  const plain = (value: string) =>
    value
      .replace(/!\[[^\]]*\]\([^\n]*?\)/g, '')
      .replace(/\[([^\]]+)\]\([^\n]*?\)/g, '$1')
      .replace(/<[^>]*>/g, '')
      .replace(/^[\s#>*`-]+/gm, '')
      .replace(/[`*_~]/g, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? '';
  return (plain(title ?? '') || plain(body) || fallback).slice(0, 200);
}

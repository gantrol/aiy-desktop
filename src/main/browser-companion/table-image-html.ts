import type { PhrasingContent, Table } from 'mdast';
import { contentPublishingMediaBindings } from '@/shared/content-publishing-mask';
import type { TablePublicationInput } from '@/shared/contracts/table-publication';

export function escapeTableText(value: string) {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');
}

function rawCellCount(line: string) {
  const text = line.trim();
  let cells = 1;
  let trailingDelimiter = false;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\\') index++;
    else if (text[index] === '|') {
      cells++;
      trailingDelimiter = index === text.length - 1;
    }
  }
  return cells - Number(text.startsWith('|')) - Number(trailingDelimiter);
}

export async function tableImageHtml(
  table: Table,
  input: TablePublicationInput,
  image: (assetId: string) => Promise<string>,
) {
  const width = table.children[0]?.children.length ?? 0;
  if (width > 8) throw new Error('TABLE_TOO_WIDE');
  if (!width || table.children.length > 1000) throw new Error('TABLE_STRUCTURE_UNSUPPORTED');
  const bindings = contentPublishingMediaBindings(input.mediaAssetIds, input.mediaBindings);
  let linksAsText = false;
  let imageCharacters = 0;
  async function inline(node: PhrasingContent): Promise<string> {
    if (node.type === 'text' || node.type === 'inlineCode') {
      const value = escapeTableText(node.value);
      return node.type === 'inlineCode' ? `<code>${value}</code>` : value;
    }
    if (node.type === 'break' || (node.type === 'html' && /^<br\s*\/?\s*>$/iu.test(node.value))) return '<br>';
    if (node.type === 'image') {
      const id = bindings.assetId(node.url);
      if (!id) throw new Error('TABLE_RESOURCE_UNAVAILABLE');
      const url = await image(id);
      imageCharacters += url.length;
      if (imageCharacters > 16 * 1024 * 1024) throw new Error('TABLE_IMAGE_LIMIT');
      return `<img src="${url}" alt="${escapeTableText(node.alt ?? '')}">`;
    }
    if (node.type === 'link') {
      // Internal figure labels depend on final gallery numbering; never bake an obsolete number into a table.
      if (!/^https?:\/\//iu.test(node.url)) throw new Error('TABLE_STRUCTURE_UNSUPPORTED');
      linksAsText = true;
    } else if (!['strong', 'emphasis', 'delete'].includes(node.type)) {
      throw new Error('TABLE_STRUCTURE_UNSUPPORTED');
    }
    const pieces: string[] = [];
    if ('children' in node) for (const child of node.children) pieces.push(await inline(child as PhrasingContent));
    const tag =
      node.type === 'strong' ? 'strong' : node.type === 'emphasis' ? 'em' : node.type === 'delete' ? 's' : 'span';
    return `<${tag}>${pieces.join('')}</${tag}>`;
  }
  const rows: string[] = [];
  for (const [index, row] of table.children.entries()) {
    const start = row.position?.start.offset,
      end = row.position?.end.offset;
    if (start === undefined || end === undefined || rawCellCount(input.markdown.slice(start, end)) > width)
      throw new Error('TABLE_STRUCTURE_UNSUPPORTED');
    const cells: string[] = [];
    for (let column = 0; column < width; column++) {
      const children: string[] = [];
      for (const node of row.children[column]?.children ?? []) children.push(await inline(node));
      const tag = index === 0 ? 'th' : 'td';
      const align = table.align?.[column] ?? 'left';
      cells.push(`<${tag} style="text-align:${align}">${children.join('')}</${tag}>`);
    }
    rows.push(`<tr>${cells.join('')}</tr>`);
  }
  return { rows, linksAsText };
}

export function tableImageDocument(rows: readonly string[], label: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>
*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#171717;width:600px}
body{padding:20px;font:24px/1.4 Arial,'Microsoft YaHei','PingFang SC',sans-serif}
table{width:560px;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #a3a3a3;padding:8px;overflow-wrap:anywhere;vertical-align:top}
th{background:#f5f5f5;font-weight:600}img{max-width:100%;height:auto;max-height:240px;object-fit:contain}code{font-size:22px}
footer{padding-top:12px;font-size:16px;color:#525252}
</style></head><body><table><thead>${rows[0]}</thead><tbody>${rows.slice(1).join('')}</tbody></table><footer>${escapeTableText(label)}</footer></body></html>`;
}

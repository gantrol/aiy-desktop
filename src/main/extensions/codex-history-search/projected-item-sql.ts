import { CODEX_HISTORY_PROJECTED_ITEM_TYPES } from '@/main/extensions/codex-history-search/message-content';

const projectedItemTypesSql = `(${CODEX_HISTORY_PROJECTED_ITEM_TYPES.map((type) => `'${type}'`).join(', ')})`;

export function codexHistoryProjectedItemJsonSql(alias: string) {
  const itemJson = `${alias}.item_json`;
  const itemType = `${alias}.item_type`;
  return `CASE
    WHEN ${itemType} = 'imageGeneration' AND json_valid(${itemJson}) THEN json_object(
      'type', json_extract(${itemJson}, '$.type'),
      'id', json_extract(${itemJson}, '$.id'),
      'status', json_extract(${itemJson}, '$.status'),
      'revisedPrompt', json_extract(${itemJson}, '$.revisedPrompt'),
      'savedPath', json_extract(${itemJson}, '$.savedPath'),
      'failure', json_extract(${itemJson}, '$.failure'),
      'transparentBackground', json_extract(${itemJson}, '$.transparentBackground')
    )
    WHEN ${itemType} = 'imageGeneration' THEN '{}'
    ELSE ${itemJson}
  END`;
}

export function codexHistoryProjectedItemBytesSql(alias: string) {
  return `length(CAST((${codexHistoryProjectedItemJsonSql(alias)}) AS BLOB))`;
}

export function codexHistoryProjectedItemTypePredicate(alias: string) {
  return `${alias}.item_type IN ${projectedItemTypesSql}`;
}

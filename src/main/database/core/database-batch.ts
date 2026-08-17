export const SQLITE_SAFE_BATCH_SIZE = 400;

export function databaseBatches<T>(values: readonly T[], size = SQLITE_SAFE_BATCH_SIZE): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
}

export function sqlPlaceholders(count: number) {
  return Array.from({ length: count }, () => '?').join(', ');
}

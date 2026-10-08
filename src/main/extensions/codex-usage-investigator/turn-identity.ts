export function codexUuidV7Timestamp(value: string): number | null {
  const match = value.match(/^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  if (!match) return null;
  const timestamp = Number.parseInt(`${match[1]}${match[2]}`, 16);
  return Number.isSafeInteger(timestamp) ? timestamp : null;
}

/** A fork can retain a parent's turn even when copied records have newer timestamps. */
export function codexTurnBelongsToThread(
  turnId: string,
  startedMs: number | null,
  terminalMs: number | null,
  threadCreatedMs: number | null,
) {
  if (threadCreatedMs === null) return true;
  const boundary = startedMs ?? terminalMs;
  if (boundary === null || boundary < threadCreatedMs) return false;
  const identityTime = codexUuidV7Timestamp(turnId);
  return identityTime === null || identityTime >= threadCreatedMs;
}

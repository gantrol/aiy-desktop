export function codexUuidV7Timestamp(value: string): number | null {
  const match = value.match(/^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  if (!match) return null;
  const timestamp = Number.parseInt(`${match[1]}${match[2]}`, 16);
  return Number.isSafeInteger(timestamp) ? timestamp : null;
}

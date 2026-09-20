export function contentAssetPath(assetId: string) {
  return `assets/${assetId.toLowerCase()}`;
}

/** Remote URLs are opaque asset identities, including signatures and escaped delimiters. */
export function normalizeContentMediaPath(value: string) {
  if (/^(?:https?:|\/\/)/iu.test(value)) return value;
  const path = value.split(/[?#]/u, 1)[0]!.replace(/^\.\//u, '');
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

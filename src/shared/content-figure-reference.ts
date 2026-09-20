/** The asset identity is saved; a channel's current figure number is never its identity. */
export function contentFigureReferenceUrl(assetId: string) {
  return `aiy-figure:${encodeURIComponent(assetId)}`;
}

export function contentFigureReferenceAssetId(url: string): string | null {
  if (!/^aiy-figure:/iu.test(url)) return null;
  try {
    const id = decodeURIComponent(url.slice('aiy-figure:'.length));
    return id && id.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(id) ? id : null;
  } catch {
    return null;
  }
}

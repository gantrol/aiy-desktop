export type EpubArchiveRequest =
  { id: number; kind: 'OPEN'; bytes: Uint8Array } | { id: number; kind: 'READ'; path: string; limit: number };
export type EpubArchiveResponse =
  { id: number; files: string[] } | { id: number; bytes: Uint8Array<ArrayBuffer> } | { id: number; error: string };

export const epubLimits = {
  archive: 32 * 1024 * 1024,
  entries: 5000,
  expanded: 128 * 1024 * 1024,
  resource: 16 * 1024 * 1024,
  document: 2 * 1024 * 1024,
  stylesheet: 512 * 1024,
} as const;

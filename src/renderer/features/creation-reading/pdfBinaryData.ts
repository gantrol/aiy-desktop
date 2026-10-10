const cmaps = import.meta.glob<string>('../../../../node_modules/pdfjs-dist/cmaps/*.bcmap', {
  eager: true,
  query: '?url&no-inline',
  import: 'default',
});
const fonts = import.meta.glob<string>('../../../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', {
  eager: true,
  query: '?url&no-inline',
  import: 'default',
});

/** Resolve PDF resources only from the application bundle, never a document URL. */
export class ReadingPdfBinaryData {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    const assets = kind === 'cMapUrl' ? cmaps : kind === 'standardFontDataUrl' ? fonts : null;
    const directory = kind === 'cMapUrl' ? 'cmaps' : 'standard_fonts';
    const url = assets?.['../../../../node_modules/pdfjs-dist/' + directory + '/' + filename];
    if (!url || filename.includes('/') || filename.includes('\\')) throw new Error('PDF_RESOURCE_UNAVAILABLE');
    const response = await fetch(url);
    if (!response.ok) throw new Error('PDF_RESOURCE_UNAVAILABLE');
    return new Uint8Array(await response.arrayBuffer());
  }
}

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sourceImportsModule } from './support/source-ast';

const root = path.resolve(__dirname, '..');
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8');

describe('asset file IPC and context menus', () => {
  it('exposes asset-id operations plus a validated reveal context across typed IPC', () => {
    const contracts = read('src/shared/contracts.ts');
    const preload = read('src/preload/index.ts');
    const ipc = read('src/main/ipc.ts');

    for (const method of ['assetFileAvailability', 'assetFileSaveAs', 'assetFileOpen']) {
      expect(contracts).toContain(`${method}(assetId: string)`);
      expect(preload).toContain(`${method}: (assetId) => ipcRenderer.invoke('asset-file:`);
    }
    expect(contracts).toContain("| { kind: 'ALL_MATERIALS' }");
    expect(contracts).toContain("| { kind: 'ALBUM'; albumId: string }");
    expect(contracts).toContain("| { kind: 'CREATION'; seriesId: string }");
    expect(contracts).toContain('assetFileReveal(assetId: string, context?: AssetFileRevealContext)');
    expect(preload).toContain(
      "assetFileReveal: (assetId, context) => ipcRenderer.invoke('asset-file:reveal', assetId, context)",
    );
    for (const channel of ['availability', 'save-as', 'reveal', 'open']) {
      expect(ipc).toContain(`ipcMain.handle('asset-file:${channel}'`);
    }
    expect(ipc).toContain('id.parse(rawId)');
    expect(ipc).toContain("z.discriminatedUnion('kind'");
    expect(ipc).toContain("z.object({ kind: z.literal('ALL_MATERIALS') }).strict()");
    expect(ipc).toContain("z.object({ kind: z.literal('ALBUM'), albumId: id }).strict()");
    expect(ipc).toContain("z.object({ kind: z.literal('CREATION'), seriesId: id }).strict()");
    expect(ipc).toContain('assetFileRevealContextSchema.optional().parse(rawContext)');
    expect(preload).not.toContain('sourcePath');
  });

  it('uses one shared shadcn context menu on material and creation-result image surfaces', () => {
    const menu = read('src/renderer/components/media/AssetFileContextMenu.tsx');
    expect(sourceImportsModule(menu, '@/renderer/components/ui/context-menu')).toBe(true);
    expect(menu).toContain("run('SAVE_AS')");
    expect(menu).toContain("run('REVEAL')");
    expect(menu).toContain("run('OPEN')");
    expect(menu).toContain('ActionContextMenuItems actions={actions}');
    expect(menu).toContain('assetFileReveal(assetId, context)');

    for (const relativePath of [
      'src/renderer/components/gallery/MaterialCard.tsx',
      'src/renderer/components/gallery/MaterialInspector.tsx',
      'src/renderer/components/creator/ResultLibrary.tsx',
      'src/renderer/components/creator/OutputInspector.tsx',
      'src/renderer/components/creator/OutputThumbnailRail.tsx',
      'src/renderer/components/creator/ComparisonResultStack.tsx',
      'src/renderer/components/creator/CreationReferenceStrip.tsx',
      'src/renderer/components/dictionary/DictionaryContextSidebar.tsx',
      'src/renderer/components/dictionary/TermDetailView.tsx',
    ]) {
      expect(read(relativePath), relativePath).toContain('AssetFileContextMenu');
    }
    expect(read('src/renderer/components/palette/WordPaletteLibraryItem.tsx')).toContain('notify={notify}');
  });

  it('does not render help, placeholders, or renderer-owned paths', () => {
    const menu = read('src/renderer/components/media/AssetFileContextMenu.tsx');
    expect(menu).not.toMatch(/hint|help|placeholder|unavailable/i);
    expect(menu).not.toContain('absolutePath');
  });

  it('adds material actions without splitting image file actions into another menu', () => {
    const card = read('src/renderer/components/gallery/MaterialCard.tsx');
    expect(card).toContain("id: 'details'");
    expect(card).toContain("id: 'copy'");
    expect(card).toContain('actions={commonActions}');
  });
});

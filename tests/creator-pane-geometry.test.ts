import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultCreatorPreferences,
  loadCreatorPreferences,
} from '../src/renderer/components/creator/creatorPreferences';
import { creatorPaneGeometry } from '../src/renderer/components/creator/useCreatorPanes';

function geometry(workspaceWidth: number, overrides: Partial<Parameters<typeof creatorPaneGeometry>[0]> = {}) {
  return creatorPaneGeometry({
    workspaceWidth,
    showResultLibrary: true,
    showOutputInspector: true,
    resultLibraryMode: defaultCreatorPreferences.resultLibraryMode,
    resultPanelWidth: defaultCreatorPreferences.resultPanelWidth,
    outputPanelRatio: defaultCreatorPreferences.outputPanelRatio,
    outputCollapsed: false,
    ...overrides,
  });
}

describe('creator pane geometry', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ignores the removed editor mode while preserving old v3 pane preferences', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () =>
          JSON.stringify({
            editorMode: 'full',
            resultLibraryMode: 'full',
            resultPanelWidth: 312,
            outputPanelRatio: 0.6,
            outputCollapsed: true,
          }),
      },
    });

    const preferences = loadCreatorPreferences();
    expect(preferences).toEqual({
      resultLibraryMode: 'full',
      resultPanelWidth: 312,
      outputPanelRatio: 0.6,
      outputCollapsed: true,
    });
    expect('editorMode' in preferences).toBe(false);
  });

  it('defaults to a thumbnail history rail and a 48:52 editor/output split', () => {
    const layout = geometry(1600);
    expect(layout.resultLibraryMode).toBe('images');
    expect(layout.resultWidth).toBe(84);
    expect(layout.outputWidth / (layout.centerWidth + layout.outputWidth)).toBeCloseTo(0.515, 5);
  });

  it('preserves the editor/output ratio while the window changes size', () => {
    const wide = geometry(1600);
    const narrower = geometry(1120);
    const ratio = (layout: typeof wide) => layout.outputWidth / (layout.centerWidth + layout.outputWidth);
    expect(ratio(wide)).toBeCloseTo(0.515, 5);
    expect(ratio(narrower)).toBeCloseTo(ratio(wide), 5);
  });

  it('temporarily clamps panes to minimum widths without changing the requested ratio', () => {
    const constrained = geometry(700, { resultLibraryMode: 'full', resultPanelWidth: 258 });
    expect(constrained.resultLibraryMode).toBe('images');
    expect(constrained.centerWidth).toBe(320);
    expect(constrained.outputWidth).toBe(296);

    const restored = geometry(1600, { resultLibraryMode: 'full', resultPanelWidth: 258 });
    expect(restored.resultLibraryMode).toBe('full');
    expect(restored.resultWidth).toBe(258);
    expect(restored.outputWidth / (restored.centerWidth + restored.outputWidth)).toBeCloseTo(0.515, 5);
  });

  it('treats a stale pixel width as invalid instead of expanding the output pane', () => {
    const staleHotReloadLayout = geometry(1800, { outputPanelRatio: 460 });
    const ratio =
      staleHotReloadLayout.outputWidth / (staleHotReloadLayout.centerWidth + staleHotReloadLayout.outputWidth);
    expect(ratio).toBeCloseTo(0.515, 5);
    expect(staleHotReloadLayout.centerWidth).toBeGreaterThan(800);
  });

  it('keeps a collapsed output drawer at its compact rail width', () => {
    const layout = geometry(1400, { outputCollapsed: true });
    expect(layout.outputWidth).toBe(72);
    expect(layout.centerWidth).toBe(1244);
  });
});

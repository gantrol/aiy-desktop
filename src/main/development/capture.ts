import { app, type BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Environment-gated screenshot harness for local development.
 * Production startup only imports the module; no capture work runs unless
 * AIY_CAPTURE_PATH is explicitly set.
 */
export async function runDevelopmentCapture(window: BrowserWindow) {
  const capturePath = process.env.AIY_CAPTURE_PATH;
  if (!capturePath) return false;
  const captureView = process.env.AIY_CAPTURE_VIEW;
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (
    [
      'dictionary',
      'dictionary-scroll',
      'dictionary-overview',
      'dictionary-detail',
      'dictionary-edit',
      'dictionary-palettes',
      'dictionary-palette-edit',
      'dictionary-overview-selected',
      'dictionary-overview-filtered',
      'dictionary-palette-save',
      'dictionary-palette-parameter',
      'dictionary-filter',
      'dictionary-classifications',
      'dictionary-media',
      'dictionary-media-picker',
      'new-term',
    ].includes(captureView ?? '')
  ) {
    await window.webContents.executeJavaScript('document.querySelector(\'[data-view="dictionary"]\')?.click()');
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  if (captureView === 'new-creation') {
    await window.webContents.executeJavaScript('document.querySelector(\'[data-action="new-creation"]\')?.click()');
  }
  if (captureView === 'idea-creation') {
    await window.webContents.executeJavaScript("document.querySelector('[data-idea-creation-id]')?.click()");
    await new Promise((resolve) => setTimeout(resolve, 320));
  }
  if (
    ['gallery', 'gallery-creation', 'gallery-dictionary', 'gallery-unrated', 'gallery-scroll'].includes(
      captureView ?? '',
    )
  ) {
    await window.webContents.executeJavaScript('document.querySelector(\'[data-view="gallery"]\')?.click()');
  }
  if (['codex-image-discovery', 'codex-image-discovery-import'].includes(captureView ?? '')) {
    await window.webContents.executeJavaScript('document.querySelector(\'[data-view="codexImages"]\')?.click()');
  }
  if (captureView === 'creator-album') {
    await window.webContents.executeJavaScript('document.querySelector(\'[data-album-id="album_summer"]\')?.click()');
    await new Promise((resolve) => setTimeout(resolve, 120));
    await window.webContents.executeJavaScript('document.querySelector(\'[data-album-id="album_ivory"]\')?.click()');
  }
  if (captureView === 'creator-record') {
    await window.webContents.executeJavaScript(
      'document.querySelector(\'[data-action="output-generation-record"]\')?.click()',
    );
  }
  if (captureView === 'settings') {
    await window.webContents.executeJavaScript('document.querySelector(\'[data-action="settings"]\')?.click()');
  }
  if (captureView === 'libraries') {
    await window.webContents.executeJavaScript('document.querySelector(\'[data-action="library-switcher"]\')?.click()');
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  if (captureView === 'new-term') {
    await window.webContents.executeJavaScript('document.querySelector(\'[data-action="dictionary-new"]\')?.click()');
  }
  if (
    [
      'dictionary-overview',
      'dictionary-palettes',
      'dictionary-palette-edit',
      'dictionary-overview-selected',
      'dictionary-overview-filtered',
      'dictionary-palette-save',
      'dictionary-palette-parameter',
    ].includes(captureView ?? '')
  ) {
    await window.webContents.executeJavaScript(
      'document.querySelector(\'[data-action="dictionary-overview"]\')?.click()',
    );
  }
  if (captureView === 'dictionary-filter') {
    await window.webContents.executeJavaScript(
      'document.querySelector(\'[data-action="dictionary-filter"]\')?.click()',
    );
  }
  if (captureView === 'dictionary-classifications') {
    await window.webContents.executeJavaScript(
      'document.querySelector(\'[data-action="dictionary-classifications"]\')?.click()',
    );
    await new Promise((resolve) => setTimeout(resolve, 420));
  }
  if (
    [
      'creator-dictionary',
      'creator-palettes',
      'creator-palette-preview',
      'creator-parameter-palette',
      'creator-palette-applied',
      'creator-term-preview',
    ].includes(captureView ?? '')
  ) {
    await window.webContents.executeJavaScript(
      'document.querySelector(\'[data-action="dictionary-picker"]\')?.click()',
    );
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  if (captureView === 'creator-canvas-presets') {
    await window.webContents.executeJavaScript(
      'document.querySelector(\'[data-action="canvas-preset-picker"]\')?.click()',
    );
  }
  if (captureView === 'codex') {
    await window.webContents.executeJavaScript('document.querySelector(\'[data-action="codex-drawer"]\')?.click()');
  }
  if (captureView === 'background-tasks') {
    await window.webContents.executeJavaScript('document.querySelector(\'[data-action="background-tasks"]\')?.click()');
  }
  if (captureView === 'creator-rename') {
    await window.webContents.executeJavaScript('document.querySelector(\'[data-action="rename-series"]\')?.click()');
  }
  if (['dictionary-media', 'dictionary-media-picker'].includes(captureView ?? '')) {
    await window.webContents.executeJavaScript(`(() => {
      const item = document.querySelector('[data-term-id]');
      item?.scrollIntoView({ block: 'center' });
      item?.querySelector('button')?.click();
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 320));
    if (captureView === 'dictionary-media-picker') {
      await window.webContents.executeJavaScript('document.querySelector(\'[data-action="term-media-add"]\')?.click()');
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
  }
  if (captureView === 'creator-stack-hover') {
    await window.webContents.executeJavaScript(`(() => {
      const stack = Array.from(document.querySelectorAll('[data-media-stack]'))
        .find((element) => element.getAttribute('data-media-count') === '3');
      stack?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 220));
  }
  if (captureView === 'creator-term-preview') {
    await window.webContents.executeJavaScript("document.querySelector('[data-palette-domain]')?.click()");
    await new Promise((resolve) => setTimeout(resolve, 120));
    await window.webContents.executeJavaScript("document.querySelector('[data-palette-type]')?.click()");
    await new Promise((resolve) => setTimeout(resolve, 120));
    await window.webContents.executeJavaScript(`(() => {
      const term = document.querySelector('[data-palette-term]');
      term?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }));
      term?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 420));
  }
  if (captureView === 'creator-more') {
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('查看更多'))?.click()`);
    await new Promise((resolve) => setTimeout(resolve, 220));
  }
  await new Promise((resolve) => setTimeout(resolve, 2500));
  if (process.env.AIY_CAPTURE_SEED_STARTER === '1') {
    await window.webContents.executeJavaScript('window.desktopApi.packImportStarter()');
    window.webContents.reload();
    await new Promise((resolve) => setTimeout(resolve, 3200));
    await window.webContents.executeJavaScript('document.querySelector(\'[data-view="dictionary"]\')?.click()');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (captureView === 'dictionary-classifications') {
    await window.webContents.executeJavaScript(
      'document.querySelector(\'[data-action="dictionary-classifications"]\')?.click()',
    );
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  if (captureView === 'codex-image-discovery-import') {
    await window.webContents.executeJavaScript(
      "document.querySelector('[data-codex-discovery-id]:not(:disabled)')?.click()",
    );
    await new Promise((resolve) => setTimeout(resolve, 120));
    await window.webContents.executeJavaScript(
      'document.querySelector(\'[data-action="codex-images-import"]\')?.click()',
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (['dictionary-detail', 'dictionary-edit'].includes(captureView ?? '')) {
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-term-overview-card]'))
      .find((card) => card.querySelector('img'))?.querySelector('[data-action="open-term"]')?.click()`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (captureView === 'dictionary-edit') {
      await window.webContents.executeJavaScript(
        'document.querySelector(\'[data-action="term-detail-edit"]\')?.click()',
      );
      await new Promise((resolve) => setTimeout(resolve, 320));
    }
  }
  if (
    [
      'dictionary-palettes',
      'dictionary-palette-edit',
      'creator-palettes',
      'creator-palette-preview',
      'creator-parameter-palette',
      'creator-palette-applied',
    ].includes(captureView ?? '')
  ) {
    const paletteLibraryOpened = await window.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('[data-action="word-palette-library"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`);
    console.info('[word-palette-library]', paletteLibraryOpened);
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  if (captureView === 'creator-palette-preview') {
    const paletteCenter = await window.webContents.executeJavaScript(`(() => {
      const palette = document.querySelector('article[data-palette-id]');
      if (!(palette instanceof HTMLElement)) return null;
      const bounds = palette.getBoundingClientRect();
      return { x: Math.round(bounds.left + bounds.width / 2), y: Math.round(bounds.top + bounds.height / 2) };
    })()`);
    if (paletteCenter) {
      window.focus();
      window.webContents.focus();
      window.webContents.sendInputEvent({ type: 'mouseMove', x: 8, y: 8 });
      await new Promise((resolve) => setTimeout(resolve, 60));
      window.webContents.sendInputEvent({ type: 'mouseMove', x: paletteCenter.x, y: paletteCenter.y });
    }
    await new Promise((resolve) => setTimeout(resolve, 1800));
    const detailsBeforeTwoSeconds = await window.webContents.executeJavaScript(
      "Boolean(document.querySelector('[data-palette-details]'))",
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    const hoverState = await window.webContents.executeJavaScript(`(() => ({
      detailsOpen: Boolean(document.querySelector('[data-palette-details]')),
      triggerHovered: Boolean(Array.from(document.querySelectorAll('article[data-palette-id]')).some((item) => item.matches(':hover'))),
    }))()`);
    console.info('[word-palette-hover]', { paletteCenter, detailsBeforeTwoSeconds, ...hoverState });
  }
  if (captureView === 'dictionary-palette-edit') {
    await window.webContents.executeJavaScript(
      'document.querySelector(\'[data-action="word-palette-edit"]\')?.click()',
    );
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  if (captureView === 'creator-parameter-palette') {
    await window.webContents.executeJavaScript(
      'document.querySelector(\'[data-palette-id] [data-action="word-palette-use"]\')?.click()',
    );
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  if (captureView === 'creator-palette-applied') {
    await window.webContents.executeJavaScript(
      'document.querySelector(\'[data-palette-id] [data-action="word-palette-use"]\')?.click()',
    );
    await new Promise((resolve) => setTimeout(resolve, 180));
    await window.webContents.executeJavaScript('document.querySelector(\'[aria-label="关闭词典"]\')?.click()');
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  if (
    [
      'dictionary-overview-selected',
      'dictionary-overview-filtered',
      'dictionary-palette-save',
      'dictionary-palette-parameter',
    ].includes(captureView ?? '')
  ) {
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-palette-term]')).slice(0, 3)
      .forEach((element) => element instanceof HTMLElement && element.click())`);
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (captureView === 'dictionary-overview-filtered') {
      await window.webContents.executeJavaScript(
        'document.querySelector(\'[data-action="word-palette-confirm"]\')?.click()',
      );
      await new Promise((resolve) => setTimeout(resolve, 320));
    }
    if (['dictionary-palette-save', 'dictionary-palette-parameter'].includes(captureView ?? '')) {
      await window.webContents.executeJavaScript(
        'document.querySelector(\'[data-action="word-palette-save"]\')?.click()',
      );
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    if (captureView === 'dictionary-palette-parameter') {
      await window.webContents.executeJavaScript(
        'document.querySelector(\'[data-action="word-palette-add-parameter"]\')?.click()',
      );
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
  if (captureView === 'dictionary-scroll') {
    const metrics = await window.webContents.executeJavaScript(`new Promise((resolve) => {
      const list = document.querySelector('[data-dictionary-term-list] [data-slot="scroll-area-viewport"]');
      if (!(list instanceof HTMLElement)) {
        resolve(null);
        return;
      }
      const before = {
        clientHeight: list.clientHeight,
        scrollHeight: list.scrollHeight,
        scrollTop: list.scrollTop,
      };
      list.scrollTop = list.scrollHeight;
      requestAnimationFrame(() => resolve({ ...before, scrolledTo: list.scrollTop }));
    })`);
    console.info('[dictionary-scroll]', metrics);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  if (captureView === 'gallery-creation' || captureView === 'gallery-dictionary') {
    const source = captureView === 'gallery-creation' ? 'CREATION' : 'DICTIONARY';
    await window.webContents.executeJavaScript(`document.querySelector('[data-gallery-filter="${source}"]')?.click()`);
    await new Promise((resolve) => setTimeout(resolve, 420));
  }
  if (captureView === 'gallery-unrated') {
    await window.webContents.executeJavaScript("document.querySelector('[data-gallery-filter-unrated]')?.click()");
    await new Promise((resolve) => setTimeout(resolve, 420));
  }
  if (captureView === 'gallery-scroll') {
    const before = await window.webContents.executeJavaScript(`(() => {
      const viewport = document.querySelector('[data-slot="scroll-area-viewport"]');
      const count = document.querySelectorAll('[data-gallery-item]').length;
      if (viewport instanceof HTMLElement) viewport.scrollTop = viewport.scrollHeight;
      return count;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 900));
    const after = await window.webContents.executeJavaScript("document.querySelectorAll('[data-gallery-item]').length");
    console.info('[gallery-scroll]', { before, after });
  }
  const image = await window.webContents.capturePage();
  mkdirSync(path.dirname(capturePath), { recursive: true });
  writeFileSync(capturePath, image.toPNG());
  app.quit();
  return true;
}

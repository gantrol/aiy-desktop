import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { actions, views } from '../e2e/support/selectors';

/**
 * Keeps the end-to-end selector contract honest at unit-lane speed.
 *
 * A journey referencing a `data-action` the renderer no longer emits fails after
 * a full app launch, minutes into a run, with a timeout that explains nothing.
 * This is the one place where matching source text is the right tool: the
 * attribute genuinely is a static string in the markup, and detecting its
 * removal is the entire point.
 *
 * The same check applies to `src/main/development/capture.ts`, which drives the
 * app through `document.querySelector(...)?.click()`. Optional chaining means a
 * stale selector there produces a screenshot of the wrong screen instead of an
 * error, so those references are verified too.
 */
const rendererRoot = path.resolve(__dirname, '../src/renderer');
const captureScript = path.resolve(__dirname, '../src/main/development/capture.ts');

function readSources(directory: string): string {
  return (
    readdirSync(directory)
      // Skips `.tmp`, which holds a stale production bundle that would match anything.
      .filter((entry) => !entry.startsWith('.'))
      .map((entry) => {
        const entryPath = path.join(directory, entry);
        if (statSync(entryPath).isDirectory()) return readSources(entryPath);
        return /\.tsx?$/.test(entry) ? readFileSync(entryPath, 'utf8') : '';
      })
      .join('\n')
  );
}

const rendererSource = readSources(rendererRoot);

/** `AppSidebar` renders `data-view={id}`, so the ids come from its items array. */
function sidebarViewIds() {
  const source = readFileSync(path.join(rendererRoot, 'components/app/AppSidebar.tsx'), 'utf8');
  const items = source.slice(source.indexOf('const items = ['), source.indexOf('] as const'));
  return new Set([...items.matchAll(/id:\s*'([^']+)'/g)].map((match) => match[1]));
}

function renderedActionNames() {
  const names = new Set([...rendererSource.matchAll(/data-action="([a-z0-9-]+)"/g)].map((match) => match[1]));
  for (const attribute of rendererSource.matchAll(/data-action=\{([^}]+)\}/g)) {
    for (const literal of attribute[1].matchAll(/['"]([a-z0-9-]+)['"]/g)) names.add(literal[1]);
  }
  return names;
}

function selectorsReferencedByCaptureScript() {
  const source = readFileSync(captureScript, 'utf8');
  return {
    actions: [...new Set([...source.matchAll(/data-action=\\?["']([a-z0-9-]+)\\?["']/g)].map((match) => match[1]))],
    views: [...new Set([...source.matchAll(/data-view=\\?["']([a-zA-Z0-9-]+)\\?["']/g)].map((match) => match[1]))],
  };
}

describe('end-to-end selector contract', () => {
  it('exposes every view the journeys navigate to', () => {
    const ids = sidebarViewIds();
    for (const name of Object.values(views)) expect([...ids]).toContain(name);
  });

  it('exposes every action the journeys click', () => {
    const rendered = renderedActionNames();
    const missing = Object.values(actions).filter((name) => !rendered.has(name));
    expect(missing).toEqual([]);
  });

  /**
   * Selectors the capture script drives that no component renders any more.
   * Each one makes `?.click()` a silent no-op, so the affected capture views
   * screenshot the wrong screen instead of failing.
   *
   * This list is a ratchet: it may only shrink. Delete an entry once the
   * capture script is repointed at a selector that exists.
   */
  const knownStaleCaptureActions = [
    'library-switcher',
    'dictionary-overview',
    'codex-drawer',
    'word-palette-add-parameter',
  ];

  it('adds no new stale selectors to the development capture script', () => {
    const referenced = selectorsReferencedByCaptureScript();
    const renderedActions = renderedActionNames();
    const renderedViews = sidebarViewIds();

    // If the capture script changes its string quoting again, fail here instead
    // of treating an empty parse as a perfectly healthy selector contract.
    expect(referenced.actions).toContain('dictionary-new');
    expect(referenced.views).toContain('dictionary');

    const missingActions = referenced.actions.filter((name) => !renderedActions.has(name));
    expect(missingActions.filter((name) => !knownStaleCaptureActions.includes(name))).toEqual([]);
    expect(referenced.views.filter((name) => !renderedViews.has(name))).toEqual([]);
  });

  it('keeps the stale-selector ratchet from silently growing stale itself', () => {
    const referenced = selectorsReferencedByCaptureScript();
    const renderedActions = renderedActionNames();
    const stillBroken = referenced.actions.filter((name) => !renderedActions.has(name));

    // Once a selector is fixed, its entry must be removed rather than left to
    // hide the next regression behind it.
    expect(knownStaleCaptureActions.filter((name) => !stillBroken.includes(name))).toEqual([]);
  });
});

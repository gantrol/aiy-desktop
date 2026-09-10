import type {
  ComposerAdapter,
  ComposerElement,
  ComposerMediaSnapshot,
  TextControl,
} from '@/lib/composer-adapters/contract';
import { isComposerElement, isVisible, normalizeDraft, readComposerText } from '@/lib/composer-adapters/dom';
import { splitXThread } from '@/lib/x-thread';

const EDITOR_SELECTOR =
  '[data-testid^="tweetTextarea_"][contenteditable="true"], [data-testid^="tweetTextarea_"] [contenteditable="true"]';
const POST_CONTROL_SELECTOR = '[data-testid="tweetButton"], [data-testid="tweetButtonInline"]';
const ATTACHMENT_SELECTOR = '[data-testid="attachments"] img, [data-testid="attachments"] video';
interface OwnedThread {
  editors: ComposerElement[];
  texts: string[];
  ids: (string | null)[];
}
const ownedThreads = new WeakMap<ComposerElement, OwnedThread>();
const mediaOwners = new WeakMap<ComposerMediaSnapshot, ComposerElement>();

function readXText(editor: TextControl): string {
  const blocks = [...editor.querySelectorAll<HTMLElement>('[data-block="true"]')];
  // innerText inserts extra blank lines around Draft.js blocks.
  return blocks.length ? blocks.map((block) => block.textContent ?? '').join('\n') : readComposerText(editor);
}

function editorsWithin(scope: ParentNode): ComposerElement[] {
  return [...new Set(scope.querySelectorAll(EDITOR_SELECTOR))].filter(isComposerElement);
}

function findEditors(): ComposerElement[] {
  // A compose dialog takes precedence over the timeline composer behind it.
  const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(isVisible);
  if (dialogs.length) return [...new Set(dialogs.flatMap(editorsWithin))];
  // X mounts the compose dialog after the timeline. Wait for that dialog on compose routes.
  if (location.pathname.startsWith('/compose/')) return [];
  return editorsWithin(document);
}

function composerScope(editor: ComposerElement): HTMLElement | null {
  const thread = ownedThreads.get(editor);
  if (thread) {
    const current = findEditors();
    if (
      current.length !== thread.editors.length ||
      thread.editors.some(
        (_item, index) =>
          thread.ids[index] !== current[index]?.getAttribute('data-testid') ||
          normalizeDraft(thread.texts[index]!) !== normalizeDraft(readXText(current[index]!)),
      )
    )
      return null;
    thread.editors.splice(0, thread.editors.length, ...current);
  }
  const expectedEditors = thread?.editors ?? [editor];
  const anchor = expectedEditors[0]!;
  for (let scope = anchor.parentElement; scope; scope = scope.parentElement) {
    if (scope === document.body) return null;
    if (scope.querySelector(POST_CONTROL_SELECTOR)) {
      const editors = editorsWithin(scope);
      if (editors.length === expectedEditors.length && editors.every((item, index) => item === expectedEditors[index]))
        return scope;
      if (editors.length > expectedEditors.length) return null;
    }
  }
  return null;
}

function attachmentElements(scope: HTMLElement): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>(ATTACHMENT_SELECTOR)].filter(isVisible);
}

function captureMedia(): ComposerMediaSnapshot | null {
  const editors = findEditors();
  const scope = editors.length === 1 && editors[0] ? composerScope(editors[0]) : null;
  if (!scope || !editors[0]) return null;
  const snapshot = { elements: new Set(attachmentElements(scope)) };
  mediaOwners.set(snapshot, editors[0]);
  return snapshot;
}

function uploadsReady(scope: HTMLElement, count: number, snapshot: ComposerMediaSnapshot): boolean {
  const attachments = attachmentElements(scope).filter((element) => !snapshot.elements.has(element));
  // X's character counter also has role=progressbar. Only media progress belongs here.
  const busy = [
    ...scope.querySelectorAll<HTMLElement>(
      '[data-testid="attachments"] [role="progressbar"], [data-testid="attachments"] [aria-busy="true"]',
    ),
  ].some(isVisible);
  return (
    !busy &&
    attachments.length === count &&
    attachments.every((element) =>
      element instanceof HTMLImageElement
        ? element.complete && element.naturalWidth > 0
        : element instanceof HTMLVideoElement && element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
    )
  );
}

async function confirmMedia(
  files: readonly File[],
  snapshot: ComposerMediaSnapshot | null,
  timeoutMs: number,
): Promise<boolean> {
  if (files.length === 0) return true;
  if (!snapshot) return false;
  const deadline = Date.now() + timeoutMs;
  let readySince: number | null = null;
  while (Date.now() < deadline) {
    const owner = mediaOwners.get(snapshot);
    const scope = owner ? composerScope(owner) : null;
    if (scope && uploadsReady(scope, files.length, snapshot)) {
      readySince ??= Date.now();
      if (Date.now() - readySince >= 500) return true;
    } else readySince = null;
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
  return false;
}

async function writeText(editor: ComposerElement, draft: string, replaceExisting: boolean): Promise<boolean> {
  editor.focus({ preventScroll: true });
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editor);
  if (!replaceExisting) range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
  const clipboardData = new DataTransfer();
  clipboardData.setData('text/plain', draft);
  // Draft.js owns both text and selection. Native insertText plus DOM fallback
  // can leave a duplicate text node when React reconciles the editor.
  const handled = !editor.dispatchEvent(
    new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData,
    }),
  );
  if (!handled) return false;
  const deadline = Date.now() + 3_000;
  let matchedSince: number | null = null;
  while (Date.now() < deadline && editor.isConnected) {
    if (normalizeDraft(readXText(editor)) === normalizeDraft(draft)) {
      matchedSince ??= Date.now();
      if (Date.now() - matchedSince >= 150) return true;
    } else matchedSince = null;
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  return false;
}

function clickXControl(element: HTMLElement): void {
  // React Native Web tracks presses through pointer/mouse down and up before click.
  const bounds = element.getBoundingClientRect();
  const position = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: bounds.left + bounds.width / 2,
    clientY: bounds.top + bounds.height / 2,
    button: 0,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  };
  element.dispatchEvent(new PointerEvent('pointerdown', { ...position, buttons: 1 }));
  element.dispatchEvent(new MouseEvent('mousedown', { ...position, buttons: 1 }));
  // HTMLElement.click() does not move focus. X commits the active draft on blur
  // before the Add control creates the next post.
  element.focus({ preventScroll: true });
  element.dispatchEvent(new PointerEvent('pointerup', { ...position, buttons: 0 }));
  element.dispatchEvent(new MouseEvent('mouseup', { ...position, buttons: 0 }));
  element.click();
}

async function appendDraft(editor: ComposerElement, drafts: readonly string[]): Promise<boolean> {
  const fail = (phase: string): false => {
    console.warn(`[AIY Companion] X thread stopped: ${phase}`);
    return false;
  };
  const owned = [editor];
  const expected = [readXText(editor)];
  const ids = [editor.getAttribute('data-testid')];
  const surface = editor.closest('[role="dialog"]') ?? composerScope(editor);
  if (!surface) return fail('surface-missing');
  ownedThreads.set(editor, { editors: owned, texts: expected, ids });
  for (const draft of drafts) {
    const deadline = Date.now() + 5_000;
    let add: HTMLButtonElement | undefined;
    while (Date.now() < deadline) {
      const scope = composerScope(editor);
      if (!scope) {
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        continue;
      }
      // X can render another Add button in the thread header. Use the controls
      // nearest the last editor, bounded by this verified thread's container.
      for (
        let controls = owned.at(-1)!.parentElement;
        controls && scope.contains(controls);
        controls = controls.parentElement
      ) {
        const buttons = [...controls.querySelectorAll<HTMLButtonElement>('button[data-testid="addButton"]')].filter(
          (button) => isVisible(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true',
        );
        if (buttons.length === 1) {
          add = buttons[0];
          break;
        }
        if (controls === scope) break;
      }
      if (add) break;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    if (!add) return fail('add-missing');
    if (!owned.every((item, index) => normalizeDraft(readXText(item)) === normalizeDraft(expected[index]!)))
      return fail('existing-text-changed');
    clickXControl(add);
    let next: ComposerElement | undefined;
    const editorDeadline = Date.now() + 5_000;
    while (Date.now() < editorDeadline) {
      const candidates = findEditors();
      if (!surface.isConnected) return fail('dialog-remounted');
      if (candidates.length > owned.length + 1) return fail('extra-editors');
      if (candidates.length === owned.length + 1) {
        // X remounts earlier Draft.js editors when switching to a thread.
        // Rebind only within the same dialog, with identical IDs and text.
        if (
          candidates.some((item) => !surface.contains(item)) ||
          owned.some(
            (item, index) =>
              ids[index] !== candidates[index]?.getAttribute('data-testid') ||
              normalizeDraft(readXText(candidates[index]!)) !== normalizeDraft(expected[index]!),
          )
        )
          return fail('previous-editors-changed');
        next = candidates[owned.length];
        owned.splice(0, owned.length, ...candidates.slice(0, -1));
        break;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    if (!next) return fail('new-editor-missing');
    if (normalizeDraft(readXText(next))) return fail('new-editor-occupied');
    // X selects the active post through its click handler. DOM focus alone can
    // leave Add attached to the preceding post and overwrite the next draft.
    clickXControl(next);
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    const activated = findEditors();
    if (
      activated.length !== owned.length + 1 ||
      activated.some(
        (item, index) =>
          !surface.contains(item) ||
          (index < owned.length &&
            (item.getAttribute('data-testid') !== ids[index] ||
              normalizeDraft(readXText(item)) !== normalizeDraft(expected[index]!))),
      )
    )
      return fail('activation-changed-thread');
    const active = activated.at(-1);
    if (
      !active ||
      active.getAttribute('data-testid') !== next.getAttribute('data-testid') ||
      normalizeDraft(readXText(active))
    )
      return fail('activation-changed-editor');
    next = active;
    owned.splice(0, owned.length, ...activated.slice(0, -1));
    owned.push(next);
    expected.push(draft);
    ids.push(next.getAttribute('data-testid'));
    if (!(await writeText(next, draft, false))) return fail('paste-not-confirmed');
  }
  const candidates = findEditors();
  return (
    candidates.length === owned.length &&
    owned.every(
      (item, index) =>
        ids[index] === candidates[index]?.getAttribute('data-testid') &&
        normalizeDraft(readXText(candidates[index]!)) === normalizeDraft(expected[index]!),
    )
  );
}

export const xComposerAdapter: ComposerAdapter = {
  findEditors,
  readText: readXText,
  splitDraft: splitXThread,
  writeText,
  appendDraft,
  acceptsMedia(files) {
    if (files.length > 4) return false;
    return files.every((file) =>
      file.type === 'image/gif'
        ? file.size <= 15 * 1024 * 1024
        : ['image/png', 'image/jpeg', 'image/webp'].includes(file.type) && file.size <= 5 * 1024 * 1024,
    );
  },
  hasExistingMedia(editor) {
    const scope = composerScope(editor);
    return Boolean(scope?.querySelector(`${ATTACHMENT_SELECTOR}, [data-testid="removeMedia"]`));
  },
  findMediaInput(editor) {
    const scope = composerScope(editor);
    const inputs = scope
      ? [...scope.querySelectorAll<HTMLInputElement>('input[type="file"][data-testid="fileInput"]')].filter(
          (input) => !input.disabled,
        )
      : [];
    return inputs.length === 1 ? (inputs[0] ?? null) : null;
  },
  requestMediaInput() {
    // X renders its file input with the composer. Never fall back to a page-wide button search.
  },
  captureMedia,
  confirmMedia,
};

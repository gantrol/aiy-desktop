import type { Page } from '@playwright/test';
import { expect, test } from './support/app-fixture';
import { expectAppReady, navigateTo, waitForRendererIdle } from './support/app-driver';
import {
  attachResponsiveActionResults,
  attribute,
  hidden,
  recordMainProcessResponsiveness,
  recordRendererResponsiveness,
  runResponsiveAction,
  startMainProcessResponsivenessObserver,
  startRendererResponsivenessObserver,
  visible,
  type ResponsiveActionResult,
} from './support/responsiveness';
import { action, actions, views } from './support/selectors';
import { seedMaterialImages, seedMaterialVolume } from './support/seed';

const library = '[data-slot="material-library"]';
const navigation = '[data-slot="material-library-navigation"]';
const inspector = '[data-slot="material-inspector"]';

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function materialCard(page: Page, name: string) {
  return page
    .getByRole('button', { name: new RegExp(escapeRegExp(name), 'i') })
    .filter({ visible: true })
    .first();
}

function materialCardById(page: Page, materialId: string) {
  return page
    .locator(`[data-action="material-open-inspector"][data-material-id="${materialId}"]`)
    .filter({ visible: true })
    .first();
}

function albumRowByTitle(page: Page, title: string) {
  return page.locator(`${navigation} [data-album-id]`).filter({ hasText: title }).first();
}

async function openMaterialLibrary(page: Page, expectedNames: string[]) {
  await expectAppReady(page);
  await navigateTo(page, views.gallery);
  await expect(page.locator(library)).toBeVisible();
  const allMaterials = page.locator(action(actions.materialAll));
  await expect(allMaterials).toBeVisible();
  await allMaterials.click();
  await expect(page.locator(library)).toHaveAttribute('data-search-state', 'ready');
  for (const name of expectedNames) await expect(materialCard(page, name)).toBeVisible();
}

async function loadMaterialPagesThrough(page: Page, targetCount: number) {
  const libraryRoot = page.locator(library);
  const pageEnd = page.locator('[data-slot="material-page-end"]');
  for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
    const loaded = Number(await libraryRoot.getAttribute('data-loaded-count'));
    if (loaded >= targetCount) return;
    await pageEnd.scrollIntoViewIfNeeded();
    await expect.poll(async () => Number(await libraryRoot.getAttribute('data-loaded-count'))).toBeGreaterThan(loaded);
  }
  throw new Error(`Material pagination did not reach ${targetCount} items`);
}

test.describe('material library lifecycle', () => {
  test('searches, changes view, edits, favorites, rates, and reopens a material', async ({
    page,
    app,
    stub,
  }, testInfo) => {
    const timings: ResponsiveActionResult[] = [];
    const alpha = 'E2E Browse Alpha.png';
    const beta = 'E2E Browse Beta.png';
    const gamma = 'E2E Browse Gamma.png';
    const renamed = 'E2E Browse Beta Renamed';
    const seeded = await seedMaterialImages(page, [alpha, beta, gamma]);
    const betaMaterialId = seeded.materialIds[1];
    expect(betaMaterialId).toBeTruthy();
    await startRendererResponsivenessObserver(page);
    await startMainProcessResponsivenessObserver(app);
    await openMaterialLibrary(page, [alpha, beta, gamma]);

    const alphaCard = materialCard(page, alpha);
    const betaCard = materialCardById(page, betaMaterialId);
    const search = page.locator(action(actions.materialSearch));
    timings.push(
      await runResponsiveAction({
        label: 'search material library',
        action: () => search.fill('Browse Beta'),
        probes: [attribute('material search pending', page.locator(library), 'data-search-state', 'pending')],
      }),
    );
    await expect(page.locator(library)).toHaveAttribute('data-search-state', 'ready');
    await expect(page.locator(library)).toHaveAttribute('data-results-state', 'current');
    await expect(betaCard).toBeVisible();
    await expect(alphaCard).toHaveCount(0);

    timings.push(
      await runResponsiveAction({
        label: 'switch material library to list view',
        action: () => page.locator(action(actions.materialListView)).click(),
        probes: [attribute('material list view selected', page.locator(library), 'data-view-mode', 'LIST')],
      }),
    );
    await expect(page.locator(library)).toHaveAttribute('data-view-mode', 'LIST');
    await expect(page.locator('[data-material-view="LIST"]')).toBeVisible();

    timings.push(
      await runResponsiveAction({
        label: 'open material inspector',
        action: () => betaCard.click(),
        probes: [visible('material inspector', page.locator(inspector))],
      }),
    );

    const inspectorPanel = page.locator(inspector);
    const favorite = inspectorPanel.locator(action(actions.materialFavoriteToggle));
    timings.push(
      await runResponsiveAction({
        label: 'favorite material',
        action: () => favorite.click(),
        probes: [
          attribute('favorite progress', favorite, 'aria-busy', 'true'),
          attribute('favorited result', favorite, 'aria-pressed', 'true'),
        ],
      }),
    );
    await expect(favorite).toHaveAttribute('aria-pressed', 'true');

    timings.push(
      await runResponsiveAction({
        label: 'open material rating controls',
        action: () => inspectorPanel.locator(action(actions.materialInspectorRating)).click(),
        probes: [visible('aesthetic rating control', inspectorPanel.locator('[data-rating-control="AESTHETIC"]'))],
      }),
    );
    const aestheticFour = inspectorPanel.locator('[data-rating-control="AESTHETIC"] [data-rating-score="4"]');
    timings.push(
      await runResponsiveAction({
        label: 'rate material aesthetic',
        action: () => aestheticFour.click(),
        probes: [attribute('aesthetic score saved', aestheticFour, 'aria-pressed', 'true')],
      }),
    );
    await expect(aestheticFour).toHaveAttribute('aria-pressed', 'true');

    timings.push(
      await runResponsiveAction({
        label: 'open material metadata',
        action: () => inspectorPanel.locator(action(actions.materialInspectorDetails)).click(),
        probes: [visible('material display name', inspectorPanel.locator('[data-field="material-display-name"]'))],
      }),
    );
    const displayName = inspectorPanel.locator('[data-field="material-display-name"]');
    await displayName.fill(renamed);
    const metadataStatus = inspectorPanel.locator('[data-slot="material-metadata-status"]');
    const saveMetadata = inspectorPanel.locator(action(actions.materialMetadataSave));
    timings.push(
      await runResponsiveAction({
        label: 'save material metadata',
        action: () => saveMetadata.click(),
        probes: [
          attribute('metadata save progress', saveMetadata, 'aria-busy', 'true'),
          attribute('metadata saved', metadataStatus, 'data-state', 'saved'),
        ],
      }),
    );
    await expect(metadataStatus).toHaveAttribute('data-state', 'saved');
    await inspectorPanel.locator(action(actions.materialInspectorClose)).click();

    const renamedCard = materialCard(page, renamed);
    await expect(renamedCard).toBeVisible();
    timings.push(
      await runResponsiveAction({
        label: 'clear material search',
        action: () => page.locator(action(actions.materialClearSearch)).click(),
        probes: [visible('unfiltered material', alphaCard)],
      }),
    );
    await expect(materialCard(page, gamma)).toBeVisible();

    const favoriteScope = page.locator(action(actions.materialScopeFavorite));
    timings.push(
      await runResponsiveAction({
        label: 'show favorite materials',
        action: () => favoriteScope.click(),
        probes: [
          attribute('favorite scope selected', favoriteScope, 'data-state', 'on'),
          hidden('non-favorite material removed', alphaCard),
        ],
      }),
    );
    await expect(renamedCard).toBeVisible();
    await expect(alphaCard).toHaveCount(0);

    // Unmount and reload the gallery query so persistence is proven through
    // the public read path rather than the optimistic local update.
    await navigateTo(page, views.dictionary);
    await navigateTo(page, views.gallery);
    await expect(page.locator(library)).toHaveAttribute('data-results-state', 'current');
    await expect(page.locator('[data-material-view="LIST"]')).toBeVisible();
    await expect(page.locator(action(actions.materialScopeFavorite))).toHaveAttribute('data-state', 'on');
    await expect(renamedCard).toBeVisible();
    await expect(alphaCard).toHaveCount(0);

    timings.push(
      await runResponsiveAction({
        label: 'reopen persisted material',
        action: () => renamedCard.click(),
        probes: [visible('reopened material inspector', inspectorPanel)],
      }),
    );
    await inspectorPanel.locator(action(actions.materialInspectorRating)).click();
    await expect(aestheticFour).toHaveAttribute('aria-pressed', 'true');
    await expect(favorite).toHaveAttribute('aria-pressed', 'true');
    await inspectorPanel.locator(action(actions.materialInspectorClose)).click();

    expect(stub.requests, 'material browsing and maintenance must not call a paid provider').toEqual([]);
    await waitForRendererIdle(page);
    await attachResponsiveActionResults(testInfo, timings);
    await recordRendererResponsiveness(page, testInfo);
    await recordMainProcessResponsiveness(app, testInfo);
  });

  test('creates, fills, renames, empties, and deletes an album without deleting its material', async ({
    page,
    app,
    stub,
  }, testInfo) => {
    const timings: ResponsiveActionResult[] = [];
    const firstName = 'E2E Album Keep One.png';
    const secondName = 'E2E Album Keep Two.png';
    const initialTitle = 'E2E Material Album';
    const renamedTitle = 'E2E Material Album Renamed';
    const seeded = await seedMaterialImages(page, [firstName, secondName]);
    const firstMaterialId = seeded.materialIds[0];
    expect(firstMaterialId).toBeTruthy();
    await startRendererResponsivenessObserver(page);
    await startMainProcessResponsivenessObserver(app);
    await openMaterialLibrary(page, [firstName, secondName]);

    const editorDialog = page.locator('[data-dialog="material-album-editor"]');
    timings.push(
      await runResponsiveAction({
        label: 'open material album creator',
        action: () => page.locator(action(actions.materialCreateAlbum)).click(),
        probes: [visible('material album editor', editorDialog)],
      }),
    );
    await page.locator('[data-field="material-album-name"]').fill(initialTitle);
    const createAlbum = page.locator(action(actions.materialAlbumSubmit));
    const initialAlbumRow = albumRowByTitle(page, initialTitle);
    timings.push(
      await runResponsiveAction({
        label: 'create material album',
        action: () => createAlbum.click(),
        probes: [
          attribute('album creation progress', editorDialog, 'data-operation-state', 'pending'),
          visible('created material album', initialAlbumRow),
        ],
      }),
    );
    await expect(initialAlbumRow).toBeVisible();
    const albumId = await initialAlbumRow.getAttribute('data-album-id');
    expect(albumId).toBeTruthy();

    const firstCard = materialCardById(page, firstMaterialId);
    timings.push(
      await runResponsiveAction({
        label: 'open material before collecting',
        action: () => firstCard.click(),
        probes: [visible('material inspector', page.locator(inspector))],
      }),
    );
    await page.locator(inspector).locator(action(actions.materialInspectorRelationships)).click();
    const membership = page.locator(`${inspector} [data-album-id="${albumId}"]`);
    const membershipCheckbox = membership.locator(action(actions.materialAlbumMembership));
    await expect(membershipCheckbox).toHaveAttribute('data-state', 'unchecked');
    timings.push(
      await runResponsiveAction({
        label: 'add material to album',
        action: () => membershipCheckbox.click(),
        probes: [attribute('album membership added', membershipCheckbox, 'data-state', 'checked')],
      }),
    );
    await expect(membershipCheckbox).toHaveAttribute('data-state', 'checked');
    await page.locator(action(actions.materialInspectorClose)).click();

    const albumRow = page.locator(`${navigation} [data-album-id="${albumId}"]`);
    const albumHeader = page.locator(`[data-slot="material-album-header"][data-album-id="${albumId}"]`);
    timings.push(
      await runResponsiveAction({
        label: 'open material album',
        action: () => albumRow.locator(action(actions.materialOpenAlbum)).click(),
        probes: [visible('material album header', albumHeader)],
      }),
    );
    await expect(albumHeader).toHaveAttribute('data-material-count', '1');
    await expect(firstCard).toBeVisible();
    await expect(materialCard(page, secondName)).toHaveCount(0);

    const albumMenu = albumRow.locator('[data-slot="action-menu-trigger"]');
    const renameAction = page.locator('[data-action-id="rename"]').filter({ visible: true }).first();
    timings.push(
      await runResponsiveAction({
        label: 'open material album actions',
        action: () => albumMenu.click(),
        probes: [visible('material album rename action', renameAction)],
      }),
    );
    timings.push(
      await runResponsiveAction({
        label: 'open material album rename dialog',
        action: () => renameAction.click(),
        probes: [visible('material album rename editor', editorDialog)],
      }),
    );
    await page.locator('[data-field="material-album-name"]').fill(renamedTitle);
    const renamedHeading = albumHeader.getByRole('heading', { name: renamedTitle });
    timings.push(
      await runResponsiveAction({
        label: 'rename material album',
        action: () => page.locator(action(actions.materialAlbumSubmit)).click(),
        probes: [
          attribute('album rename progress', editorDialog, 'data-operation-state', 'pending'),
          visible('renamed material album heading', renamedHeading),
        ],
      }),
    );
    await expect(albumRow).toContainText(renamedTitle);
    await expect(renamedHeading).toBeVisible();

    await navigateTo(page, views.dictionary);
    await navigateTo(page, views.gallery);
    await expect(page.locator(library)).toHaveAttribute('data-albums-state', 'ready');
    await expect(albumRow).toContainText(renamedTitle);
    await albumRow.locator(action(actions.materialOpenAlbum)).click();
    await expect(renamedHeading).toBeVisible();
    await expect(page.locator(library)).toHaveAttribute('data-search-state', 'ready');
    await expect(page.locator(library)).toHaveAttribute('data-results-state', 'current');
    await expect(firstCard).toBeVisible();
    const firstMaterialKey = await firstCard.getAttribute('data-material-key');
    expect(firstMaterialKey).toBeTruthy();

    timings.push(
      await runResponsiveAction({
        label: 'reopen album material',
        action: () => firstCard.click(),
        probes: [
          attribute('album material selected', page.locator(library), 'data-selected-material-key', firstMaterialKey!),
          visible('reopened album material inspector', page.locator(inspector)),
        ],
      }),
    );
    await expect(page.locator(inspector)).toBeVisible();
    await page.locator(inspector).locator(action(actions.materialInspectorRelationships)).click();
    await expect(membershipCheckbox).toHaveAttribute('data-state', 'checked');
    timings.push(
      await runResponsiveAction({
        label: 'remove material from album',
        action: () => membershipCheckbox.click(),
        probes: [attribute('album became empty', albumHeader, 'data-material-count', '0')],
      }),
    );
    await expect(albumHeader).toHaveAttribute('data-material-count', '0');
    await expect(page.locator(inspector)).toBeHidden();
    await expect(firstCard).toHaveCount(0);

    timings.push(
      await runResponsiveAction({
        label: 'return to all materials',
        action: () => page.locator(action(actions.materialAll)).click(),
        probes: [visible('preserved material after album removal', firstCard)],
      }),
    );
    await expect(materialCard(page, secondName)).toBeVisible();

    await albumMenu.click();
    const deleteAction = page.locator('[data-action-id="delete"]').filter({ visible: true }).first();
    await expect(deleteAction).toBeVisible();
    const deleteDialog = page.locator('[data-dialog="material-album-delete"]');
    timings.push(
      await runResponsiveAction({
        label: 'open material album deletion',
        action: () => deleteAction.click(),
        probes: [visible('material album delete confirmation', deleteDialog)],
      }),
    );
    timings.push(
      await runResponsiveAction({
        label: 'delete empty material album',
        action: () => page.locator(action(actions.materialAlbumDeleteConfirm)).click(),
        probes: [
          attribute('album deletion progress', deleteDialog, 'data-operation-state', 'pending'),
          hidden('deleted material album removed', albumRow),
        ],
      }),
    );
    await expect(albumRow).toHaveCount(0);
    await expect(firstCard).toBeVisible();
    await expect(materialCard(page, secondName)).toBeVisible();

    await navigateTo(page, views.dictionary);
    await navigateTo(page, views.gallery);
    await expect(albumRow).toHaveCount(0);
    await expect(firstCard).toBeVisible();
    expect(stub.requests, 'material album maintenance must not call a paid provider').toEqual([]);

    await waitForRendererIdle(page);
    await attachResponsiveActionResults(testInfo, timings);
    await recordRendererResponsiveness(page, testInfo);
    await recordMainProcessResponsiveness(app, testInfo);
  });

  test('collects the maximum supported 200-material batch responsively and persists it', async ({
    page,
    app,
    stub,
  }, testInfo) => {
    test.setTimeout(90_000);
    const timings: ResponsiveActionResult[] = [];
    const albumTitle = 'E2E Batch Collection';
    const volume = await seedMaterialVolume(page, 200);
    await startRendererResponsivenessObserver(page);
    await startMainProcessResponsivenessObserver(app);
    await openMaterialLibrary(page, ['volume-00199.png']);
    await page.locator(action(actions.materialListView)).click();
    await expect(page.locator(library)).toHaveAttribute('data-view-mode', 'LIST');
    await loadMaterialPagesThrough(page, 200);

    const editorDialog = page.locator('[data-dialog="material-album-editor"]');
    await page.locator(action(actions.materialCreateAlbum)).click();
    await expect(editorDialog).toBeVisible();
    await page.locator('[data-field="material-album-name"]').fill(albumTitle);
    const albumRow = albumRowByTitle(page, albumTitle);
    timings.push(
      await runResponsiveAction({
        label: 'create destination for material batch',
        action: () => page.locator(action(actions.materialAlbumSubmit)).click(),
        probes: [
          attribute('batch album creation progress', editorDialog, 'data-operation-state', 'pending'),
          visible('batch destination album', albumRow),
        ],
      }),
    );
    const albumId = await albumRow.getAttribute('data-album-id');
    expect(albumId).toBeTruthy();

    timings.push(
      await runResponsiveAction({
        label: 'enter material batch selection',
        action: () => page.locator(action(actions.materialSelectionMode)).click(),
        probes: [attribute('selection mode active', page.locator(library), 'data-selection-mode', 'active')],
      }),
    );
    const volumeCards = page.getByRole('button', { name: /volume-\d{5}\.png/i }).filter({ visible: true });
    await expect.poll(() => volumeCards.count()).toBeGreaterThanOrEqual(50);
    const selectedCount = await volumeCards.count();
    const firstMaterialId = await volumeCards.first().getAttribute('data-material-id');
    const lastMaterialId = await volumeCards.last().getAttribute('data-material-id');
    expect(firstMaterialId).toBeTruthy();
    expect(lastMaterialId).toBeTruthy();
    timings.push(
      await runResponsiveAction({
        label: 'select first material in batch',
        action: () => volumeCards.first().click(),
        probes: [attribute('first material selected', page.locator(library), 'data-selected-count', '1')],
      }),
    );
    timings.push(
      await runResponsiveAction({
        label: 'extend selection across loaded material page',
        action: () => volumeCards.last().click({ modifiers: ['Shift'] }),
        probes: [
          attribute('full material page selected', page.locator(library), 'data-selected-count', String(selectedCount)),
        ],
      }),
    );

    const batchDialog = page.locator('[data-dialog="material-batch-destinations"]');
    timings.push(
      await runResponsiveAction({
        label: 'open material batch destinations',
        action: () => page.locator(action(actions.materialBatchAdd)).click(),
        probes: [visible('material batch destination picker', batchDialog)],
      }),
    );
    const destination = batchDialog.locator(`[data-destination-album-id="${albumId}"]`);
    await destination.locator(action(actions.materialBatchDestinationAlbum)).click();
    timings.push(
      await runResponsiveAction({
        label: `add ${selectedCount} materials to one album`,
        action: () => batchDialog.locator(action(actions.materialBatchConfirm)).click(),
        probes: [
          attribute('material batch write progress', batchDialog, 'data-operation-state', 'pending'),
          attribute('material batch persisted', albumRow, 'data-material-count', String(selectedCount)),
          visible('material batch write error', batchDialog.getByRole('alert')),
        ],
      }),
    );
    await expect(batchDialog).toBeHidden();
    await expect(albumRow).toHaveAttribute('data-material-count', String(selectedCount));

    await page.locator(action(actions.materialBatchClear)).click();
    await albumRow.locator(action(actions.materialOpenAlbum)).click();
    const albumHeader = page.locator(`[data-slot="material-album-header"][data-album-id="${albumId}"]`);
    await expect(albumHeader).toHaveAttribute('data-material-count', String(selectedCount));
    await loadMaterialPagesThrough(page, selectedCount);
    await expect(materialCardById(page, firstMaterialId!)).toBeVisible();
    await expect(materialCardById(page, lastMaterialId!)).toBeVisible();

    await navigateTo(page, views.dictionary);
    await navigateTo(page, views.gallery);
    await expect(page.locator(library)).toHaveAttribute('data-albums-state', 'ready');
    await expect(albumRow).toHaveAttribute('data-material-count', String(selectedCount));
    await albumRow.locator(action(actions.materialOpenAlbum)).click();
    await expect(albumHeader).toHaveAttribute('data-material-count', String(selectedCount));
    await loadMaterialPagesThrough(page, selectedCount);
    await expect(materialCardById(page, lastMaterialId!)).toBeVisible();
    expect(stub.requests, 'material batch maintenance must not call a paid provider').toEqual([]);

    await testInfo.attach('material-batch-volume.json', {
      body: JSON.stringify({ ...volume, selectedCount }, null, 2),
      contentType: 'application/json',
    });
    await waitForRendererIdle(page);
    await attachResponsiveActionResults(testInfo, timings);
    await recordRendererResponsiveness(page, testInfo);
    await recordMainProcessResponsiveness(app, testInfo);
  });
});

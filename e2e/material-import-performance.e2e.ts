import { stat } from 'node:fs/promises';
import { performance as nodePerformance } from 'node:perf_hooks';
import type { JSHandle, Page } from '@playwright/test';
import { expectAppReady, navigateTo } from './support/app-driver';
import { expect, test } from './support/app-fixture';
import { createHighResolutionPng, createPaddedPng } from './support/image-fixtures';
import {
  attachResponsiveActionResults,
  attribute,
  recordMainProcessResponsiveness,
  recordRendererResponsiveness,
  runResponsiveAction,
  startMainProcessResponsivenessObserver,
  startRendererResponsivenessObserver,
  textChanged,
  textContentNow,
  visible,
} from './support/responsiveness';
import { action, actions, activeView, views } from './support/selectors';
import { seedMaterialVolume, seedReplayImage } from './support/seed';

const galleryIntakeSurface = '[data-slot="intake-surface"][data-intake-context="GALLERY"]';
const dropOverlay = '[data-slot="global-drop-overlay"]';
const progressOverlay = '[data-slot="intake-progress-overlay"]';
const draftTray = '[data-slot="intake-draft-tray"]';
const intakePreview = '[data-slot="intake-preview"]';
const fileDropSource = '[data-e2e-file-drop-source]';

async function openGalleryIntake(page: Page) {
  await expectAppReady(page);
  await navigateTo(page, views.gallery);
  await expect(page.locator(galleryIntakeSurface)).toBeVisible();
  await expect(page.locator(galleryIntakeSurface)).toHaveAttribute('data-intake-state', 'IDLE');
}

async function prepareFileDrop(page: Page, filePaths: string[]): Promise<JSHandle<DataTransfer>> {
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.hidden = true;
    input.setAttribute('data-e2e-file-drop-source', '');
    document.body.append(input);
  });
  const input = page.locator(fileDropSource);
  await input.setInputFiles(filePaths);
  const transfer = await input.evaluateHandle((element) => {
    const dataTransfer = new DataTransfer();
    for (const file of (element as HTMLInputElement).files ?? []) dataTransfer.items.add(file);
    return dataTransfer;
  });
  return transfer;
}

async function dropFilesForReview(
  page: Page,
  transfer: JSHandle<DataTransfer>,
  responses: Awaited<ReturnType<typeof runResponsiveAction>>[],
) {
  const surface = page.locator(galleryIntakeSurface);
  responses.push(
    await runResponsiveAction({
      label: 'drag images over material library',
      action: () => surface.dispatchEvent('dragenter', { dataTransfer: transfer }),
      probes: [visible('drop target feedback', page.locator(dropOverlay))],
    }),
  );
  // A script-created DataTransfer can enter Chromium's protected drag state
  // after dragenter and expose an empty FileList on a later synthetic drop.
  // Rebuild the drop transfer from the still-mounted input to model the file
  // access Chromium grants to a real drop event.
  const dropTransfer = await page.locator(fileDropSource).evaluateHandle((element) => {
    const dataTransfer = new DataTransfer();
    for (const file of (element as HTMLInputElement).files ?? []) dataTransfer.items.add(file);
    return dataTransfer;
  });
  responses.push(
    await runResponsiveAction({
      label: 'drop images for review',
      action: () => surface.dispatchEvent('drop', { dataTransfer: dropTransfer }),
      probes: [
        visible('image reading progress', page.locator(progressOverlay)),
        visible('image review', page.locator(draftTray)),
      ],
    }),
  );
  // The intake controller keeps the File objects after the drop handler returns
  // and decodes them asynchronously. Keep their input and DataTransfers alive;
  // Playwright releases them with the page after the test finishes.
}

test.describe('material image intake', () => {
  test('imports one ordinary image without freezing either Electron process', async ({ page, app, stub }, testInfo) => {
    const filePath = testInfo.outputPath('e2e-single-import.png');
    await createPaddedPng(filePath, 1_024, 113);
    await openGalleryIntake(page);
    const transfer = await prepareFileDrop(page, [filePath]);
    await startRendererResponsivenessObserver(page);
    await startMainProcessResponsivenessObserver(app);

    const responses: Awaited<ReturnType<typeof runResponsiveAction>>[] = [];
    const journeyStartedAt = nodePerformance.now();
    await dropFilesForReview(page, transfer, responses);
    await expect(page.locator(intakePreview)).toHaveCount(1);
    const previewReadyMs = nodePerformance.now() - journeyStartedAt;

    const commitStartedAt = nodePerformance.now();
    const importedCard = page.getByRole('button', { name: /e2e-single-import/i });
    responses.push(
      await runResponsiveAction({
        label: 'commit one image import',
        action: () => page.locator(action(actions.intakeImport)).click(),
        probes: [
          attribute('import progress', page.locator(action(actions.intakeImport)), 'aria-busy', 'true'),
          visible('imported material', importedCard),
        ],
      }),
    );
    await expect(page.locator(activeView(views.gallery))).toBeVisible();
    await expect(importedCard).toBeVisible();
    const commitCompletedMs = nodePerformance.now() - commitStartedAt;

    await testInfo.attach('material-import-phases.json', {
      body: JSON.stringify({ previewReadyMs, commitCompletedMs }, null, 2),
      contentType: 'application/json',
    });
    await attachResponsiveActionResults(testInfo, responses);
    await recordRendererResponsiveness(page, testInfo);
    await recordMainProcessResponsiveness(app, testInfo);
    expect(stub.requests).toEqual([]);
  });

  test('keeps a 48 MB three-image batch responsive with progress or an immediate result', async ({
    page,
    app,
    stub,
  }, testInfo) => {
    test.setTimeout(90_000);
    const filePaths: string[] = [];
    const fileSizes: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const target = testInfo.outputPath(`stress-${index + 1}.png`);
      filePaths.push(target);
      fileSizes.push(await createPaddedPng(target, 16 * 1024 * 1024, index + 1));
    }

    await openGalleryIntake(page);
    const filePreparationStartedAt = nodePerformance.now();
    const transfer = await prepareFileDrop(page, filePaths);
    const playwrightFilePreparationMs = nodePerformance.now() - filePreparationStartedAt;
    await startRendererResponsivenessObserver(page);
    await startMainProcessResponsivenessObserver(app);

    const responses: Awaited<ReturnType<typeof runResponsiveAction>>[] = [];
    const chooseStartedAt = nodePerformance.now();
    await dropFilesForReview(page, transfer, responses);
    await expect(page.locator(intakePreview)).toHaveCount(3, { timeout: 30_000 });
    const previewReadyMs = nodePerformance.now() - chooseStartedAt;

    const commitStartedAt = nodePerformance.now();
    const firstImportedCard = page.getByRole('button', { name: /stress-1/i });
    responses.push(
      await runResponsiveAction({
        label: 'commit 48 MB image batch',
        action: () => page.locator(action(actions.intakeImport)).click(),
        probes: [
          attribute('batch import progress', page.locator(action(actions.intakeImport)), 'aria-busy', 'true'),
          visible('imported batch', firstImportedCard),
        ],
      }),
    );
    await expect(page.locator(activeView(views.gallery))).toBeVisible({ timeout: 30_000 });
    for (let index = 0; index < 3; index += 1) {
      await expect(page.getByRole('button', { name: new RegExp(`stress-${index + 1}`, 'i') })).toBeVisible({
        timeout: 30_000,
      });
    }
    const commitCompletedMs = nodePerformance.now() - commitStartedAt;

    await testInfo.attach('material-import-phases.json', {
      body: JSON.stringify(
        {
          fileSizes,
          filesStillPresent: await Promise.all(filePaths.map(async (filePath) => (await stat(filePath)).isFile())),
          playwrightFilePreparationMs,
          previewReadyMs,
          commitCompletedMs,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    await attachResponsiveActionResults(testInfo, responses);
    await recordRendererResponsiveness(page, testInfo);
    await recordMainProcessResponsiveness(app, testInfo);
    expect(stub.requests).toEqual([]);
  });

  test('decodes and imports a 24 megapixel image with foreground feedback', async ({ page, app, stub }, testInfo) => {
    const filePath = testInfo.outputPath('e2e-24-megapixel.png');
    const fixture = await createHighResolutionPng(filePath, 6_000, 4_000);
    await openGalleryIntake(page);
    const transfer = await prepareFileDrop(page, [filePath]);
    await startRendererResponsivenessObserver(page);
    await startMainProcessResponsivenessObserver(app);

    const responses: Awaited<ReturnType<typeof runResponsiveAction>>[] = [];
    const previewStartedAt = nodePerformance.now();
    await dropFilesForReview(page, transfer, responses);
    await expect(page.locator(intakePreview)).toHaveCount(1, { timeout: 30_000 });
    const previewReadyMs = nodePerformance.now() - previewStartedAt;

    const importedCard = page.getByRole('button', { name: /e2e-24-megapixel/i });
    const commitStartedAt = nodePerformance.now();
    responses.push(
      await runResponsiveAction({
        label: 'commit 24 megapixel image',
        action: () => page.locator(action(actions.intakeImport)).click(),
        probes: [
          attribute('large image import progress', page.locator(action(actions.intakeImport)), 'aria-busy', 'true'),
          visible('imported large image', importedCard),
        ],
      }),
    );
    await expect(importedCard).toBeVisible({ timeout: 30_000 });
    const commitCompletedMs = nodePerformance.now() - commitStartedAt;

    responses.push(
      await runResponsiveAction({
        label: 'open imported 24 megapixel material',
        action: () => importedCard.click(),
        probes: [visible('large image inspector', page.locator('[data-slot="material-inspector"]'))],
      }),
    );
    const inspector = page.locator('[data-slot="material-inspector"]');
    const copyButton = inspector.locator(action(actions.assetFileCopy));
    const operationToast = page.locator('[data-slot="toast"]');
    for (let index = 0; index < 8 && (await operationToast.isVisible()); index += 1) {
      await operationToast.getByRole('button').evaluate((button: HTMLButtonElement) => button.click());
    }
    const toastBeforeCopy = await textContentNow(operationToast);
    await app.evaluate(({ clipboard }) => clipboard.clear());
    responses.push(
      await runResponsiveAction({
        label: 'copy 24 megapixel image without blocking Electron',
        action: () => copyButton.click(),
        probes: [
          attribute('large image copy progress', copyButton, 'aria-busy', 'true'),
          textChanged('large image copy feedback', operationToast, toastBeforeCopy),
          {
            label: 'large image copied',
            active: async () => {
              const size = await app.evaluate(({ clipboard }) => clipboard.readImage().getSize());
              return size.width === fixture.width && size.height === fixture.height;
            },
          },
        ],
      }),
    );
    await expect(copyButton).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
    const clipboardSize = await app.evaluate(({ clipboard }) => clipboard.readImage().getSize());
    if (await operationToast.isVisible()) {
      await operationToast.getByRole('button').evaluate((button: HTMLButtonElement) => button.click());
    }
    const copyFeedback = await textContentNow(operationToast);
    expect(clipboardSize, `Copy feedback: ${copyFeedback ?? 'none'}`).toEqual({
      width: fixture.width,
      height: fixture.height,
    });

    await testInfo.attach('material-import-phases.json', {
      body: JSON.stringify({ fixture, previewReadyMs, commitCompletedMs, clipboardSize }, null, 2),
      contentType: 'application/json',
    });
    await attachResponsiveActionResults(testInfo, responses);
    await recordRendererResponsiveness(page, testInfo);
    await recordMainProcessResponsiveness(app, testInfo);
    expect(stub.requests).toEqual([]);
  });

  test('imports into a 2,000-item material library without a silent foreground stall', async ({
    page,
    app,
    stub,
  }, testInfo) => {
    test.setTimeout(120_000);
    await expectAppReady(page);
    const volume = await seedMaterialVolume(page, 2_000);
    await navigateTo(page, views.gallery);
    await expect(page.locator(galleryIntakeSurface)).toBeVisible();

    const filePath = testInfo.outputPath('e2e-large-library-import.png');
    await createPaddedPng(filePath, 1_024, 197);
    const transfer = await prepareFileDrop(page, [filePath]);
    await startRendererResponsivenessObserver(page);
    await startMainProcessResponsivenessObserver(app);

    const responses: Awaited<ReturnType<typeof runResponsiveAction>>[] = [];
    const previewStartedAt = nodePerformance.now();
    await dropFilesForReview(page, transfer, responses);
    await expect(page.locator(intakePreview)).toHaveCount(1, { timeout: 30_000 });
    const previewReadyMs = nodePerformance.now() - previewStartedAt;

    const importedCard = page.getByRole('button', { name: /e2e-large-library-import/i });
    const commitStartedAt = nodePerformance.now();
    responses.push(
      await runResponsiveAction({
        label: 'commit image into 2,000-item library',
        action: () => page.locator(action(actions.intakeImport)).click(),
        probes: [
          attribute('large library import progress', page.locator(action(actions.intakeImport)), 'aria-busy', 'true'),
          visible('large library import result', importedCard),
        ],
      }),
    );
    await expect(importedCard).toBeVisible({ timeout: 30_000 });
    const commitCompletedMs = nodePerformance.now() - commitStartedAt;

    const searchStartedAt = nodePerformance.now();
    const search = page.locator(action(actions.materialSearch));
    const volumeCard = page.getByRole('button', { name: /volume-01999\.png/i });
    responses.push(
      await runResponsiveAction({
        label: 'search a 2,000-item material library',
        action: () => search.fill('volume-01999'),
        probes: [
          attribute(
            'large library search pending',
            page.locator('[data-slot="material-library"]'),
            'data-search-state',
            'pending',
          ),
        ],
      }),
    );
    await expect(page.locator('[data-slot="material-library"]')).toHaveAttribute('data-search-state', 'ready');
    await expect(volumeCard).toBeVisible();
    const searchCompletedMs = nodePerformance.now() - searchStartedAt;

    const inspectorStartedAt = nodePerformance.now();
    responses.push(
      await runResponsiveAction({
        label: 'open a material from 2,000-item search results',
        action: () => volumeCard.click(),
        probes: [visible('large library material inspector', page.locator('[data-slot="material-inspector"]'))],
      }),
    );
    const inspectorOpenedMs = nodePerformance.now() - inspectorStartedAt;
    await page.locator(action(actions.materialInspectorClose)).click();

    await testInfo.attach('material-import-phases.json', {
      body: JSON.stringify(
        { volume, previewReadyMs, commitCompletedMs, searchCompletedMs, inspectorOpenedMs },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    await attachResponsiveActionResults(testInfo, responses);
    await recordRendererResponsiveness(page, testInfo);
    await recordMainProcessResponsiveness(app, testInfo);
    expect(stub.requests).toEqual([]);
  });
});

test.describe('material image intake concurrency', () => {
  test.use({ intakeCommitDelayMs: 3_000 });

  test('keeps an existing material editable while another image import is pending', async ({
    page,
    app,
    stub,
  }, testInfo) => {
    test.setTimeout(60_000);
    await expectAppReady(page);
    await seedReplayImage(page);
    await openGalleryIntake(page);

    const existingCard = page.getByRole('button', { name: /valid-64x64/i });
    await expect(existingCard).toBeVisible();

    const filePath = testInfo.outputPath('e2e-concurrent-import.png');
    await createPaddedPng(filePath, 1_024, 211);
    const transfer = await prepareFileDrop(page, [filePath]);
    await startRendererResponsivenessObserver(page);
    await startMainProcessResponsivenessObserver(app);

    const responses: Awaited<ReturnType<typeof runResponsiveAction>>[] = [];
    await dropFilesForReview(page, transfer, responses);
    await expect(page.locator(intakePreview)).toHaveCount(1);

    const surface = page.locator(galleryIntakeSurface);
    const progress = page.locator(progressOverlay);
    const importedCard = page.getByRole('button', { name: /e2e-concurrent-import/i });
    const commitStartedAt = nodePerformance.now();
    responses.push(
      await runResponsiveAction({
        label: 'start non-modal image import',
        action: () => page.locator(action(actions.intakeImport)).click(),
        probes: [visible('non-modal import progress', progress), visible('imported material', importedCard)],
      }),
    );
    await expect(surface).toHaveAttribute('data-intake-state', 'COMMITTING_IMPORT');
    await expect(progress).toBeVisible();

    responses.push(
      await runResponsiveAction({
        label: 'open an existing material while import is pending',
        action: () => existingCard.click(),
        probes: [visible('existing material inspector', page.locator('[data-slot="material-inspector"]'))],
      }),
    );
    await page.locator('[data-action="material-inspector-details"]').click();
    const displayName = page.locator('[data-field="material-display-name"]');
    await displayName.fill('Edited while another import runs');
    await expect(displayName).toHaveValue('Edited while another import runs');

    // Editing must happen during the unresolved commit, not merely after the
    // imported card appears.
    await expect(surface).toHaveAttribute('data-intake-state', 'COMMITTING_IMPORT');
    await expect(progress).toBeVisible();
    const metadataStatus = page.locator('[data-slot="material-metadata-status"]');
    const saveMetadata = page.locator('[data-action="material-metadata-save"]');
    responses.push(
      await runResponsiveAction({
        label: 'save existing material metadata while import is pending',
        action: () => saveMetadata.click(),
        probes: [
          attribute('metadata save progress', saveMetadata, 'aria-busy', 'true'),
          attribute('saved metadata', metadataStatus, 'data-state', 'saved'),
        ],
      }),
    );
    await expect(metadataStatus).toHaveAttribute('data-state', 'saved');
    const editCompletedMs = nodePerformance.now() - commitStartedAt;

    await page.locator('[data-action="material-inspector-close"]').click();
    await expect(importedCard).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Edited while another import runs/i })).toBeVisible();
    const commitCompletedMs = nodePerformance.now() - commitStartedAt;

    await testInfo.attach('material-import-concurrency.json', {
      body: JSON.stringify({ configuredPendingMs: 3_000, editCompletedMs, commitCompletedMs }, null, 2),
      contentType: 'application/json',
    });
    await attachResponsiveActionResults(testInfo, responses);
    await recordRendererResponsiveness(page, testInfo);
    await recordMainProcessResponsiveness(app, testInfo);
    expect(stub.requests).toEqual([]);
  });
});

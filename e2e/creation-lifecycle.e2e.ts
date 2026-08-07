import { expect, test } from './support/app-fixture';
import { expectAppReady, navigateTo, reloadApp, waitForRendererIdle } from './support/app-driver';
import {
  attachResponsiveActionResults,
  attribute,
  attributeNot,
  hidden,
  recordMainProcessResponsiveness,
  recordRendererResponsiveness,
  runResponsiveAction,
  startMainProcessResponsivenessObserver,
  startRendererResponsivenessObserver,
  textChanged,
  textContentNow,
  visible,
  type ResponsiveActionResult,
} from './support/responsiveness';
import { action, actions, views } from './support/selectors';
import { seedCreationVolume, seedReplayImage, seedTerm } from './support/seed';

function visibleAction(page: Parameters<typeof expectAppReady>[0], name: (typeof actions)[keyof typeof actions]) {
  return page.locator(action(name)).filter({ visible: true }).first();
}

test.describe('creation lifecycle', () => {
  test('composes, saves, reopens, renames, and deletes a creation', async ({ page, app, stub }, testInfo) => {
    const timings: ResponsiveActionResult[] = [];
    const manualPrompt = 'Editorial portrait with quiet geometry';
    const renamedTitle = 'E2E Quiet Geometry';
    const term = await seedTerm(page, {
      title: 'E2E Quiet Geometry Term',
      titleLocale: 'en',
      localizations: [{ locale: 'zh', title: '端到端静谧几何', definition: '', aliases: [] }],
      positive: 'quiet geometric framing',
      approved: true,
    });
    await reloadApp(page);
    await startRendererResponsivenessObserver(page);
    await startMainProcessResponsivenessObserver(app);
    await navigateTo(page, views.creator);

    timings.push(
      await runResponsiveAction({
        label: 'start a new creation',
        action: () => visibleAction(page, actions.newCreation).click(),
        probes: [visible('new creation save control', page.locator(action(actions.saveCreationV01)))],
      }),
    );

    const composer = page.locator('[data-creator-prompt-editor] [contenteditable="true"]').first();
    await expect(composer).toBeVisible();
    await composer.fill(manualPrompt);

    const pickerTerm = page.locator(`[data-palette-term-id="${term.id}"]`).filter({ visible: true }).first();
    const pickerSearch = page.locator(action(actions.creatorReferenceSearch)).filter({ visible: true }).first();
    timings.push(
      await runResponsiveAction({
        label: 'open creator reference picker',
        action: () => page.locator(action(actions.dictionaryPicker)).click(),
        probes: [visible('reference search', pickerSearch)],
      }),
    );
    timings.push(
      await runResponsiveAction({
        label: 'search creator references',
        action: () => pickerSearch.fill(term.title),
        probes: [visible('reference term choice', pickerTerm)],
      }),
    );
    const creatorTerm = page.locator(`[data-creator-term-id="${term.id}"]`);
    timings.push(
      await runResponsiveAction({
        label: 'insert reference term into prompt',
        action: () => pickerTerm.click(),
        probes: [visible('structured term chip', creatorTerm)],
      }),
    );
    await page.keyboard.press('Escape');
    await expect(creatorTerm).toBeVisible();

    const saveButton = page.locator(action(actions.saveCreationV01));
    await expect(saveButton).toBeEnabled();
    const selectedSeries = page
      .locator('[data-series-id][data-result-library-selected="true"]')
      .filter({ visible: true })
      .first();
    const operationToast = page.locator('[data-slot="toast"]');
    const toastBeforeSave = await textContentNow(operationToast);
    timings.push(
      await runResponsiveAction({
        label: 'save creation as V01',
        action: () => saveButton.click(),
        probes: [
          attribute('save progress', saveButton, 'aria-busy', 'true'),
          visible('saved series', selectedSeries),
          textChanged('save feedback', operationToast, toastBeforeSave),
        ],
      }),
    );
    const saveFeedback = await textContentNow(operationToast);
    await expect(selectedSeries, `Save V01 feedback: ${saveFeedback ?? 'none'}`).toBeVisible();
    const seriesId = await selectedSeries.getAttribute('data-series-id');
    expect(seriesId).toBeTruthy();

    await navigateTo(page, views.dictionary);
    await navigateTo(page, views.creator);

    const newCreationButton = visibleAction(page, actions.newCreation);
    timings.push(
      await runResponsiveAction({
        label: 'start another creation',
        action: () => newCreationButton.click(),
        probes: [visible('new creation save control', page.locator(action(actions.saveCreationV01)))],
      }),
    );

    const savedSeries = page.locator(`[data-series-id="${seriesId}"]`).filter({ visible: true }).first();
    timings.push(
      await runResponsiveAction({
        label: 'reopen saved creation',
        action: () => savedSeries.click(),
        probes: [
          attribute('selected saved series', savedSeries, 'data-result-library-selected', 'true'),
          visible('rename control', page.locator(action(actions.renameSeries))),
        ],
      }),
    );
    await expect(composer).toContainText(manualPrompt);
    await expect(page.locator(`[data-creator-term-id="${term.id}"]`)).toBeVisible();

    const renameDialog = page.locator('[data-dialog="rename-series"]');
    timings.push(
      await runResponsiveAction({
        label: 'open creation rename dialog',
        action: () => page.locator(action(actions.renameSeries)).click(),
        probes: [visible('rename dialog', renameDialog)],
      }),
    );
    await page.locator('#series-title').fill(renamedTitle);
    const renamedSeries = page
      .locator(`[data-series-id="${seriesId}"][data-result-library-selected="true"]`)
      .filter({ visible: true })
      .first();
    const renamedSeriesTitle = renamedSeries.locator(`[title="${renamedTitle}"]`);
    const renameSubmit = page.locator(action(actions.renameSeriesSubmit));
    const toastBeforeRename = await textContentNow(operationToast);
    timings.push(
      await runResponsiveAction({
        label: 'rename creation',
        action: () => renameSubmit.click(),
        probes: [
          attribute('rename progress', renameSubmit, 'aria-busy', 'true'),
          visible('renamed series title', renamedSeriesTitle),
          textChanged('rename feedback', operationToast, toastBeforeRename),
        ],
      }),
    );
    await expect(renameDialog).toBeHidden();
    await expect(renamedSeriesTitle).toBeVisible();

    const deleteAction = page.locator('[data-action-id="delete"]').filter({ visible: true }).first();
    timings.push(
      await runResponsiveAction({
        label: 'open creation context actions',
        action: () => renamedSeries.click({ button: 'right' }),
        probes: [visible('creation delete action', deleteAction)],
      }),
    );

    const deleteDialog = page.locator('[data-dialog="delete-entity"]');
    timings.push(
      await runResponsiveAction({
        label: 'open creation delete confirmation',
        action: () => deleteAction.click(),
        probes: [visible('creation delete confirmation', deleteDialog)],
      }),
    );

    const deleteConfirm = page.locator(action(actions.deleteEntityConfirm));
    const toastBeforeDelete = await textContentNow(operationToast);
    timings.push(
      await runResponsiveAction({
        label: 'delete creation',
        action: () => deleteConfirm.click(),
        probes: [
          attribute('delete progress', deleteConfirm, 'aria-busy', 'true'),
          hidden('deleted creation removed', renamedSeries),
          textChanged('delete feedback', operationToast, toastBeforeDelete),
        ],
      }),
    );
    await expect(deleteDialog).toBeHidden();
    await expect(renamedSeries).toHaveCount(0);

    await navigateTo(page, views.dictionary);
    await navigateTo(page, views.creator);
    await expect(page.locator(`[data-series-id="${seriesId}"]`)).toHaveCount(0);
    expect(stub.requests, 'creation save and browse must not call a paid provider').toEqual([]);

    await waitForRendererIdle(page);
    await attachResponsiveActionResults(testInfo, timings);
    await recordRendererResponsiveness(page, testInfo);
    await recordMainProcessResponsiveness(app, testInfo);
  });

  test('generates with the local replay model and never reaches a provider', async ({ page, app, stub }, testInfo) => {
    const timings: ResponsiveActionResult[] = [];
    await seedReplayImage(page);
    await reloadApp(page);
    await startRendererResponsivenessObserver(page);
    await startMainProcessResponsivenessObserver(app);
    await navigateTo(page, views.creator);

    timings.push(
      await runResponsiveAction({
        label: 'start local generation draft',
        action: () => visibleAction(page, actions.newCreation).click(),
        probes: [visible('new creation prompt', page.locator('[data-creator-prompt-editor]'))],
      }),
    );

    const composer = page.locator('[data-creator-prompt-editor] [contenteditable="true"]').first();
    await expect(composer).toBeVisible();
    await composer.fill('E2E local replay generation');

    const modelSelector = page.locator(action(actions.modelTargetSelector));
    timings.push(
      await runResponsiveAction({
        label: 'open generation model selector',
        action: () => modelSelector.click(),
        probes: [visible('model choices', page.locator('[data-model-key]'))],
      }),
    );

    const otherSelected = page.locator(
      '[data-model-key]:not([data-model-key="internal-library-random"]) [role="option"][aria-selected="true"]',
    );
    while ((await otherSelected.count()) > 0) await otherSelected.first().click();
    const replayModel = page.locator('[data-model-key="internal-library-random"] [role="option"]');
    await expect(replayModel).toHaveAttribute('aria-disabled', 'false');
    if ((await replayModel.getAttribute('aria-selected')) !== 'true') await replayModel.click();
    await page.keyboard.press('Escape');

    const generateButton = page.locator(action(actions.generate));
    await expect(generateButton).toBeEnabled();
    const generatedAsset = page.locator('[data-output-asset-id]').first();
    timings.push(
      await runResponsiveAction({
        label: 'start local generation',
        action: () => generateButton.click(),
        probes: [
          attribute('generation progress', generateButton, 'aria-busy', 'true'),
          visible('background generation task', page.locator('[data-generation-task], [data-generation-batch]')),
          visible('generated output', generatedAsset),
        ],
      }),
    );
    await expect(generatedAsset).toBeVisible({ timeout: 15_000 });
    expect(stub.requests, 'the local replay model must not make an HTTP provider request').toEqual([]);

    const inspectorImage = page.locator('[data-slot="output-inspector-image"]');
    await expect(inspectorImage).toBeVisible();
    const sourceAssetId = await inspectorImage.getAttribute('data-asset-id');
    expect(sourceAssetId).toBeTruthy();
    const aspectDialog = page.locator('[data-dialog="image-aspect"]');
    timings.push(
      await runResponsiveAction({
        label: 'open local image transform',
        action: () => page.locator(action(actions.imageTransformOpen)).click(),
        probes: [visible('image aspect dialog', aspectDialog)],
      }),
    );
    await aspectDialog.locator('[data-image-ratio="3:4"]').click();
    const transformSubmit = page.locator(action(actions.imageTransformSubmit));
    timings.push(
      await runResponsiveAction({
        label: 'crop a local output in the background',
        action: () => transformSubmit.click(),
        probes: [
          attribute('image crop progress', aspectDialog, 'data-operation-state', 'pending'),
          attribute('image crop button progress', transformSubmit, 'aria-busy', 'true'),
          attributeNot('cropped image result', inspectorImage, 'data-asset-id', sourceAssetId!),
        ],
      }),
    );
    await expect(aspectDialog).toBeHidden({ timeout: 30_000 });
    await expect.poll(() => inspectorImage.getAttribute('data-asset-id')).not.toBe(sourceAssetId);
    const croppedAssetId = await inspectorImage.getAttribute('data-asset-id');
    expect(croppedAssetId).toBeTruthy();

    await navigateTo(page, views.dictionary);
    await navigateTo(page, views.creator);
    await expect(page.locator(`[data-output-asset-id="${croppedAssetId}"]`)).toBeVisible();
    expect(stub.requests, 'local crop must not make an HTTP provider request').toEqual([]);

    await waitForRendererIdle(page);
    await attachResponsiveActionResults(testInfo, timings);
    await recordRendererResponsiveness(page, testInfo);
    await recordMainProcessResponsiveness(app, testInfo);
  });

  test('keeps a large creation history responsive and returns its oldest and newest records', async ({
    page,
    app,
    stub,
  }, testInfo) => {
    test.setTimeout(120_000);
    const volume = 320;
    await expectAppReady(page);
    await startRendererResponsivenessObserver(page);
    await startMainProcessResponsivenessObserver(app);
    const seeded = await seedCreationVolume(page, volume);
    expect(seeded.firstSeriesId).toBeTruthy();
    expect(seeded.lastSeriesId).toBeTruthy();
    const snapshot = await page.evaluate(async ({ firstSeriesId, lastSeriesId }) => {
      const startedAt = performance.now();
      const data = await window.desktopApi.bootstrap('en');
      return {
        durationMs: performance.now() - startedAt,
        count: data.series.length,
        hasFirst: data.series.some((series) => series.id === firstSeriesId),
        hasLast: data.series.some((series) => series.id === lastSeriesId),
      };
    }, seeded);
    expect(snapshot.count).toBeGreaterThanOrEqual(volume);
    expect(snapshot.hasFirst).toBe(true);
    expect(snapshot.hasLast).toBe(true);
    expect(snapshot.durationMs, 'large workbench bootstrap exceeded the foreground interaction budget').toBeLessThan(
      2_000,
    );

    await reloadApp(page);
    await startRendererResponsivenessObserver(page);
    await navigateTo(page, views.creator);
    await expect(
      page.locator(`[data-series-id="${seeded.lastSeriesId}"]`).filter({ visible: true }).first(),
    ).toBeVisible();
    const progressiveRoot = page.locator('[data-total-root-count]').filter({ visible: true }).first();
    await expect(progressiveRoot).toBeVisible();
    const renderedRootCount = Number(await progressiveRoot.getAttribute('data-rendered-root-count'));
    const totalRootCount = Number(await progressiveRoot.getAttribute('data-total-root-count'));
    expect(totalRootCount).toBeGreaterThanOrEqual(volume);
    expect(renderedRootCount).toBeLessThan(totalRootCount);
    expect(renderedRootCount).toBeLessThanOrEqual(96);
    expect(stub.requests, 'creation volume browse must not call a paid provider').toEqual([]);

    await waitForRendererIdle(page);
    await testInfo.attach('creation-volume-profile.json', {
      body: JSON.stringify(
        { volume, seedDurationMs: seeded.durationMs, renderedRootCount, totalRootCount, ...snapshot },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    await recordRendererResponsiveness(page, testInfo);
    await recordMainProcessResponsiveness(app, testInfo);
  });
});

import { writeFile } from 'node:fs/promises';
import { imageFixture } from '../tests/support/fixtures';
import { expect, stubOpenDialog, test } from './support/app-fixture';
import { expectAppReady, keepStarterPackEmpty, navigateTo, reloadApp, waitForRendererIdle } from './support/app-driver';
import {
  attachResponsiveActionResults,
  attribute,
  attributeNot,
  recordMainProcessResponsiveness,
  recordRendererResponsiveness,
  runResponsiveAction,
  startMainProcessResponsivenessObserver,
  startRendererResponsivenessObserver,
  visible,
  type ResponsiveActionResult,
} from './support/responsiveness';
import { action, actions, views } from './support/selectors';
import { seedTerm } from './support/seed';

test.describe('reference lifecycle', () => {
  test('creates, edits, approves, browses, and reopens a term', async ({ page, app }, testInfo) => {
    const timings: ResponsiveActionResult[] = [];
    const title = 'E2E Luminous Grain';
    const positive = 'luminous analog grain with restrained highlights';

    await expectAppReady(page);
    await keepStarterPackEmpty(page);
    await startRendererResponsivenessObserver(page);
    await startMainProcessResponsivenessObserver(app);
    await navigateTo(page, views.dictionary);

    await page.locator(action(actions.dictionaryClassifications)).click();
    const classificationDialog = page.locator('[data-dialog="classification-editor"]');
    await page.locator(action(actions.classificationNewRoot)).click();
    await classificationDialog.locator('#classification-name').fill('E2E texture');
    await classificationDialog.locator('#classification-name-locale').fill('en');
    await classificationDialog.locator(action(actions.classificationSubmit)).click();
    await expect(classificationDialog).toBeHidden();

    const newTermDialog = page.locator('[data-dialog="new-term"]');
    timings.push(
      await runResponsiveAction({
        label: 'open new-term dialog',
        action: () => page.locator(action(actions.classificationNewTerm)).click(),
        probes: [visible('new-term dialog', newTermDialog)],
      }),
    );
    await page.locator('#new-term-title').fill(title);
    await page.locator('#new-term-locale').fill('en');

    const editor = page.locator('[data-term-editor]');
    const createButton = page.locator(action(actions.dictionaryNewSubmit));
    timings.push(
      await runResponsiveAction({
        label: 'create reference term',
        action: () => createButton.click(),
        probes: [attribute('create progress', createButton, 'aria-busy', 'true'), visible('term editor', editor)],
      }),
    );
    await expect(editor).toBeVisible();
    const termId = await editor.getAttribute('data-term-id');
    expect(termId).toBeTruthy();

    await page.locator('#term-definition').fill('A restrained luminous grain treatment for image generation.');
    await expect(editor.getByRole('checkbox', { name: 'E2E texture', exact: true })).toBeChecked();
    await page.locator(action(actions.termAddExpression)).click();
    await page.locator('#term-expression-positive-0').fill(positive);
    const saveButton = page.locator(action(actions.termSave));
    await expect(saveButton).toBeEnabled();
    timings.push(
      await runResponsiveAction({
        label: 'save term draft',
        action: () => saveButton.click(),
        probes: [
          attribute('term save progress', editor, 'data-operation-state', 'pending'),
          attribute('saved term is no longer dirty', saveButton, 'disabled', ''),
        ],
      }),
    );
    await expect(editor).toHaveAttribute('data-operation-state', 'idle');
    await expect(saveButton).toBeDisabled();

    const detail = page.locator(`[data-term-detail][data-term-id="${termId}"]`);
    const approveButton = page.locator(action(actions.termApprove));
    timings.push(
      await runResponsiveAction({
        label: 'approve term',
        action: () => approveButton.click(),
        probes: [
          attribute('approval progress', editor, 'data-operation-state', 'pending'),
          visible('term detail', detail),
        ],
      }),
    );
    await expect(detail).toBeVisible();

    timings.push(
      await runResponsiveAction({
        label: 'return to reference overview',
        action: () => page.locator(action(actions.dictionaryContextBack)).click(),
        probes: [visible('reference search', page.locator(action(actions.dictionarySearch)))],
      }),
    );

    const result = page.locator(`[data-term-id="${termId}"] ${action(actions.openTerm)}`);
    timings.push(
      await runResponsiveAction({
        label: 'search reference library',
        action: () => page.locator(action(actions.dictionarySearch)).fill(title),
        probes: [visible('matching term', result)],
      }),
    );
    timings.push(
      await runResponsiveAction({
        label: 'reopen searched term',
        action: () => result.click(),
        probes: [visible('reopened term detail', detail)],
      }),
    );
    await expect(detail).toContainText(positive);

    await waitForRendererIdle(page);
    await attachResponsiveActionResults(testInfo, timings);
    await recordRendererResponsiveness(page, testInfo);
    await recordMainProcessResponsiveness(app, testInfo);
  });

  test('scrolls the term editor and persists alternate-language maintenance', async ({ page }) => {
    const term = await seedTerm(page, {
      title: '多语言维护词条',
      titleLocale: 'zh',
      definition: '用于验证词条维护页滚动。',
      positive: 'multilingual term maintenance',
      approved: true,
      localizations: [
        {
          locale: 'en',
          title: 'Multilingual maintenance term',
          definition: 'Used to verify scrolling in term maintenance.',
          aliases: [],
        },
      ],
    });
    await reloadApp(page);
    await navigateTo(page, views.dictionary);

    await page.locator(action(actions.dictionarySearch)).fill('Multilingual maintenance term');
    await page.locator(`[data-term-id="${term.id}"] ${action(actions.openTerm)}`).click();
    await page.locator(action(actions.termDetailEdit)).click();

    const editor = page.locator(`[data-term-editor][data-term-id="${term.id}"]`);
    const viewport = editor.locator('[data-term-editor-scroll] [data-slot="scroll-area-viewport"]');
    const languageSection = editor.locator('[data-editor-section="localizations"]');
    await expect(editor).toBeVisible();
    await expect.poll(() => viewport.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

    await viewport.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll'));
    });
    await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    await languageSection.scrollIntoViewIfNeeded();
    await page.locator('#term-localization-title-0').fill('Maintained multilingual term');
    await page.locator('#term-localization-definition-0').fill('Persisted alternate-language definition.');
    await page.locator('#term-localization-aliases-0').fill('multilingual alias, maintained alias');

    for (const [index, localization] of [
      { locale: 'ja', title: '多言語メンテナンス用語', definition: '日本語の定義。' },
      { locale: 'fr', title: 'Terme de maintenance multilingue', definition: 'Définition française.' },
      { locale: 'de', title: 'Mehrsprachiger Wartungsbegriff', definition: 'Deutsche Definition.' },
    ].entries()) {
      await page.locator(action(actions.termAddLocalization)).click();
      const rowIndex = index + 1;
      await page.locator(`#term-localization-locale-${rowIndex}`).fill(localization.locale);
      await page.locator(`#term-localization-title-${rowIndex}`).fill(localization.title);
      await page.locator(`#term-localization-definition-${rowIndex}`).fill(localization.definition);
    }
    const saveButton = page.locator(action(actions.termSave));
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(saveButton).toBeDisabled();
    await expect(editor).toHaveAttribute('data-operation-state', 'idle');
    await page.locator(action(actions.termApprove)).click();
    await expect(page.locator(`[data-term-detail][data-term-id="${term.id}"]`)).toBeVisible();

    await reloadApp(page);
    await navigateTo(page, views.dictionary);
    await page.locator(action(actions.dictionarySearch)).fill('多言語メンテナンス用語');
    const savedResult = page.locator(`[data-term-id="${term.id}"] ${action(actions.openTerm)}`);
    await expect(savedResult).toBeVisible();
    await savedResult.click();
    await page.locator(action(actions.termDetailEdit)).click();
    const localizationRow = (locale: string) => editor.locator(`[data-localization-locale="${locale}"]`);
    await expect(localizationRow('en').locator('input[id^="term-localization-title-"]')).toHaveValue(
      'Maintained multilingual term',
    );
    await expect(localizationRow('en').locator('textarea[id^="term-localization-definition-"]')).toHaveValue(
      'Persisted alternate-language definition.',
    );
    const savedAliases = localizationRow('en').locator('input[id^="term-localization-aliases-"]');
    await expect
      .poll(async () =>
        (await savedAliases.inputValue())
          .split(',')
          .map((value) => value.trim())
          .sort(),
      )
      .toEqual(['maintained alias', 'multilingual alias']);
    await expect(localizationRow('ja').locator('input[id^="term-localization-title-"]')).toHaveValue(
      '多言語メンテナンス用語',
    );
    await expect(localizationRow('fr').locator('input[id^="term-localization-title-"]')).toHaveValue(
      'Terme de maintenance multilingue',
    );
    await expect(localizationRow('de').locator('input[id^="term-localization-title-"]')).toHaveValue(
      'Mehrsprachiger Wartungsbegriff',
    );
  });

  test('keeps shallow and deep classified term images visible in the dictionary', async ({ page, app }) => {
    await expectAppReady(page);
    await keepStarterPackEmpty(page);
    await navigateTo(page, views.dictionary);
    await page.locator(action(actions.dictionaryClassifications)).click();
    const classificationScreen = page.locator('[data-dictionary-classifications]');
    await expect(classificationScreen).toBeVisible();

    const classificationDialog = page.locator('[data-dialog="classification-editor"]');
    await page.locator(action(actions.classificationNewRoot)).click();
    await classificationDialog.locator('#classification-name').fill('E2E wardrobe');
    await classificationDialog.locator('#classification-name-locale').fill('en');
    await classificationDialog.locator(action(actions.classificationSubmit)).click();
    await expect(classificationDialog).toBeHidden();

    const inspector = page.locator('[data-classification-inspector]');
    await expect(inspector).toContainText('E2E wardrobe');

    const hierarchyNames = ['E2E dresses', 'E2E long dresses', 'E2E formal dresses', 'E2E evening dresses'];
    let expectedPath = 'E2E wardrobe';
    for (const name of hierarchyNames) {
      await inspector.locator(action(actions.classificationNewChild)).click();
      await classificationDialog.locator('#classification-name').fill(name);
      await classificationDialog.locator('#classification-name-locale').fill('en');
      await classificationDialog.locator(action(actions.classificationSubmit)).click();
      await expect(classificationDialog).toBeHidden();
      expectedPath = `${expectedPath} / ${name}`;
      await expect(inspector).toContainText(expectedPath);
    }

    const classifications = await page.evaluate(async () => {
      const tree = await window.desktopApi.dictionaryClassificationsTree('en');
      const root = tree.nodes.find((node) => node.name === 'E2E wardrobe');
      const child = tree.nodes.find((node) => node.name === 'E2E dresses');
      const grandchild = tree.nodes.find((node) => node.name === 'E2E long dresses');
      const fourth = tree.nodes.find((node) => node.name === 'E2E formal dresses');
      const fifth = tree.nodes.find((node) => node.name === 'E2E evening dresses');
      if (!root || !child || !grandchild || !fourth || !fifth) {
        throw new Error('E2E five-level classification hierarchy was not created');
      }
      return { root, child, grandchild, fourth, fifth };
    });

    await expect(inspector).toContainText(classifications.fifth.path);
    const enabledSwitch = inspector.getByRole('switch');
    await expect(enabledSwitch).toHaveAttribute('data-state', 'checked');
    const switchGeometry = await enabledSwitch.evaluate((element) => {
      const track = element.getBoundingClientRect();
      const thumb = element.firstElementChild?.getBoundingClientRect();
      return thumb
        ? { trackLeft: track.left, trackRight: track.right, thumbLeft: thumb.left, thumbRight: thumb.right }
        : null;
    });
    expect(switchGeometry).not.toBeNull();
    expect(switchGeometry!.thumbLeft).toBeGreaterThanOrEqual(switchGeometry!.trackLeft);
    expect(switchGeometry!.thumbRight).toBeLessThanOrEqual(switchGeometry!.trackRight);

    const dialog = page.locator('[data-dialog="new-term"]');
    const editor = page.locator('[data-term-editor]');
    const contextSidebar = page.locator('[data-dictionary-context-sidebar]');
    const mediaPicker = page.locator('[data-dialog="term-media-picker"]');

    const createClassifiedTerm = async (
      classification: { id: string; path: string },
      title: string,
      definition: string,
      positive: string,
      fixtureName: string,
    ) => {
      await page.locator(action(actions.classificationNewTerm)).click();
      await expect(dialog).toContainText(classification.path);
      await dialog.locator('#new-term-title').fill(title);
      await dialog.locator('#new-term-locale').fill('en');
      await dialog.locator(action(actions.dictionaryNewSubmit)).click();

      await expect(editor).toBeVisible();
      const breadcrumb = contextSidebar.locator('nav');
      for (const segment of classification.path.split(' / ')) {
        await expect(breadcrumb.getByText(segment, { exact: true })).toBeVisible();
      }
      await expect(contextSidebar).not.toContainText('Uncategorized');
      await expect(contextSidebar).not.toContainText('其他');
      await expect(editor.getByRole('checkbox', { name: classification.path, exact: true })).toBeChecked();

      await editor.locator(action(actions.termMediaAdd)).click();
      await expect(mediaPicker).toBeVisible();
      await stubOpenDialog(app, [imageFixture(fixtureName)]);
      await mediaPicker.locator(action(actions.termMediaPickerImport)).click();
      await expect(mediaPicker).toBeHidden();
      const importedImage = editor.locator('img[data-asset-id]').first();
      await expect(importedImage).toBeVisible();
      const assetId = await importedImage.getAttribute('data-asset-id');
      expect(assetId).toBeTruthy();
      await expect(editor.locator(`img[data-asset-id="${assetId}"]`)).toBeVisible();

      await page.locator('#term-definition').fill(definition);
      await page.locator(action(actions.termAddExpression)).click();
      await page.locator('#term-expression-positive-0').fill(positive);
      await page.locator(action(actions.termSave)).click();
      await expect(page.locator(action(actions.termSave))).toBeDisabled();

      const termId = await editor.getAttribute('data-term-id');
      expect(termId).toBeTruthy();
      const persisted = await page.evaluate(
        (id) =>
          window.desktopApi
            .dictionaryGet(id, 'en')
            .then((term) => ({ ids: term.classificationIds, primaryId: term.primaryDirectoryClassificationId })),
        termId!,
      );
      expect(persisted.ids).toContain(classification.id);
      expect(persisted.primaryId).toBe(classification.id);

      await page.locator(action(actions.termApprove)).click();
      await expect(page.locator(`[data-term-detail][data-term-id="${termId}"]`)).toBeVisible();
      return { termId: termId!, assetId: assetId! };
    };

    const expectTermCardImage = async (termId: string, assetId: string) => {
      const card = page.locator(`[data-term-overview-card][data-term-id="${termId}"]`);
      const image = card.locator(`img[data-asset-id="${assetId}"]`);
      await expect(card).toBeVisible();
      await expect(image).toBeVisible();
      await expect
        .poll(() =>
          image.evaluate((element) => {
            const imageElement = element as HTMLImageElement;
            return imageElement.complete && imageElement.naturalWidth > 0;
          }),
        )
        .toBe(true);
    };

    const deepTerm = await createClassifiedTerm(
      classifications.fifth,
      'E2E evening floor-length dress',
      'A deeply classified dress with a visible dictionary cover.',
      'evening floor-length dress',
      'valid-64x64.png',
    );

    await page.locator(action(actions.dictionaryContextBack)).click();
    const classificationLevel = (level: number) => page.locator(`[data-classification-level="${level}"]`);
    await classificationLevel(1).locator(`[data-classification-option="${classifications.root.id}"]`).click();
    await classificationLevel(2).locator(`[data-classification-option="${classifications.child.id}"]`).click();
    await classificationLevel(3).locator(`[data-classification-option="${classifications.grandchild.id}"]`).click();
    await classificationLevel(4).locator(`[data-classification-option="${classifications.fourth.id}"]`).click();
    await classificationLevel(5).locator(`[data-classification-option="${classifications.fifth.id}"]`).click();
    await expectTermCardImage(deepTerm.termId, deepTerm.assetId);

    const categoryPane = page.locator('[data-dictionary-category-columns]');
    const termPane = page.locator('[data-dictionary-term-pane]');
    await expect(termPane).toBeVisible();
    await expect.poll(() => categoryPane.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await expect.poll(() => categoryPane.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    const layout = await categoryPane.evaluate((element) => {
      const browser = element.parentElement!.getBoundingClientRect();
      const category = element.getBoundingClientRect();
      const term = element.parentElement!.querySelector('[data-dictionary-term-pane]')!.getBoundingClientRect();
      return { browserWidth: browser.width, categoryWidth: category.width, termWidth: term.width };
    });
    expect(layout.categoryWidth).toBeLessThanOrEqual(layout.browserWidth * 0.61);
    expect(layout.termWidth).toBeGreaterThanOrEqual(320);

    await page.locator(action(actions.dictionaryClassifications)).click();
    await expect(classificationScreen).toBeVisible();
    await page.locator(`[data-classification-root-id="${classifications.root.id}"]`).click();
    await expect(inspector).toContainText(classifications.root.path);
    const shallowTerm = await createClassifiedTerm(
      classifications.root,
      'E2E wardrobe reference',
      'A shallow classified term with a visible dictionary cover.',
      'wardrobe reference',
      'valid-1024x1024.png',
    );

    await page.locator(action(actions.dictionaryContextBack)).click();
    await classificationLevel(1).locator(`[data-classification-option="${classifications.root.id}"]`).click();
    await expectTermCardImage(shallowTerm.termId, shallowTerm.assetId);
    await expectTermCardImage(deepTerm.termId, deepTerm.assetId);

    await classificationLevel(2).locator(`[data-classification-option="${classifications.child.id}"]`).click();
    await classificationLevel(3).locator(`[data-classification-option="${classifications.grandchild.id}"]`).click();
    await classificationLevel(4).locator(`[data-classification-option="${classifications.fourth.id}"]`).click();
    await classificationLevel(5).locator(`[data-classification-option="${classifications.fifth.id}"]`).click();
    await expectTermCardImage(deepTerm.termId, deepTerm.assetId);
    await expect(page.locator(`[data-term-overview-card][data-term-id="${shallowTerm.termId}"]`)).toHaveCount(0);
  });

  test('archives and restores an approved term without losing the active record', async ({ page, app }, testInfo) => {
    const timings: ResponsiveActionResult[] = [];
    const term = await seedTerm(page, {
      title: 'E2E Archive Restore',
      titleLocale: 'en',
      localizations: [{ locale: 'zh', title: '端到端归档恢复', definition: '', aliases: [] }],
      positive: 'archival restoration reference',
      approved: true,
    });
    await reloadApp(page);
    await startRendererResponsivenessObserver(page);
    await startMainProcessResponsivenessObserver(app);
    await navigateTo(page, views.dictionary);

    const result = page.locator(`[data-term-id="${term.id}"] ${action(actions.openTerm)}`);
    await page.locator(action(actions.dictionarySearch)).fill(term.title);
    await expect(result).toBeVisible();
    await result.click();
    await page.locator(action(actions.termDetailEdit)).click();

    const editor = page.locator(`[data-term-editor][data-term-id="${term.id}"]`);
    await expect(editor).toHaveAttribute('data-editorial-state', 'APPROVED');
    await page.locator(action(actions.termStateActions)).click();
    await page.locator(action(actions.termArchive)).click();

    timings.push(
      await runResponsiveAction({
        label: 'archive approved term',
        action: () => page.locator(action(actions.termArchiveConfirm)).click(),
        probes: [
          attribute('archive progress', editor, 'data-operation-state', 'pending'),
          attribute('archived state', editor, 'data-editorial-state', 'ARCHIVED'),
        ],
      }),
    );
    await expect(editor).toHaveAttribute('data-editorial-state', 'ARCHIVED');
    await expect(editor).toHaveAttribute('data-operation-state', 'idle');

    await page.locator(action(actions.termStateActions)).click();
    const restoreButton = page.locator(action(actions.termRestore));
    await expect(restoreButton).toBeVisible();
    timings.push(
      await runResponsiveAction({
        label: 'restore archived term',
        action: () => restoreButton.click(),
        probes: [
          attribute('restore progress', editor, 'data-operation-state', 'pending'),
          attribute('restored draft state', editor, 'data-editorial-state', 'DRAFT'),
        ],
      }),
    );
    await expect(editor).toHaveAttribute('data-editorial-state', 'DRAFT');
    await expect(editor).toHaveAttribute('data-operation-state', 'idle');

    await waitForRendererIdle(page);
    await attachResponsiveActionResults(testInfo, timings);
    await recordRendererResponsiveness(page, testInfo);
    await recordMainProcessResponsiveness(app, testInfo);
  });

  test('creates and refreshes deterministic maintenance reports', async ({ page, app }, testInfo) => {
    const timings: ResponsiveActionResult[] = [];
    await seedTerm(page, {
      title: 'E2E Maintenance Candidate',
      titleLocale: 'en',
      localizations: [{ locale: 'zh', title: '端到端维护候选', definition: '', aliases: [] }],
    });
    await reloadApp(page);
    await startRendererResponsivenessObserver(page);
    await startMainProcessResponsivenessObserver(app);
    await navigateTo(page, views.dictionary);

    const dialog = page.locator('[data-dialog="dictionary-maintenance"]');
    timings.push(
      await runResponsiveAction({
        label: 'open dictionary maintenance',
        action: () => page.locator(action(actions.dictionaryMaintenance)).click(),
        probes: [visible('maintenance dialog', dialog), attribute('maintenance progress', dialog, 'aria-busy', 'true')],
      }),
    );
    await expect(dialog).toHaveAttribute('aria-busy', 'false');
    const firstReport = dialog.locator('[data-maintenance-report-id]').first();
    await expect(firstReport).toBeVisible();
    const previousReportId = await firstReport.getAttribute('data-maintenance-report-id');

    const refreshButton = page.locator(action(actions.dictionaryMaintenanceRefresh));
    timings.push(
      await runResponsiveAction({
        label: 'refresh dictionary maintenance report',
        action: () => refreshButton.click(),
        probes: [
          attribute('maintenance refresh progress', dialog, 'aria-busy', 'true'),
          attributeNot('new maintenance report', firstReport, 'data-maintenance-report-id', previousReportId ?? ''),
        ],
      }),
    );
    await expect(dialog).toHaveAttribute('aria-busy', 'false');
    await expect(firstReport).not.toHaveAttribute('data-maintenance-report-id', previousReportId ?? '');

    await waitForRendererIdle(page);
    await attachResponsiveActionResults(testInfo, timings);
    await recordRendererResponsiveness(page, testInfo);
    await recordMainProcessResponsiveness(app, testInfo);
  });

  test('stages, commits, searches, and opens a 5,000-term import without blocking the foreground', async ({
    page,
    app,
    stub,
  }, testInfo) => {
    test.setTimeout(120_000);
    const rowCount = 5_000;
    const filePath = testInfo.outputPath('e2e-dictionary-volume.csv');
    const rows = ['stableKey,title,titleLocale,modelKey,expressionContextKey,expressionLocale,positive'];
    for (let index = 0; index < rowCount; index += 1) {
      const suffix = String(index).padStart(5, '0');
      rows.push(
        `term.e2e_bulk_${suffix},E2E Bulk Term ${suffix},en,gpt-image-2,legacy.unspecified,en,bulk prompt ${suffix}`,
      );
    }
    await writeFile(filePath, `${rows.join('\n')}\n`, 'utf8');
    await app.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [selectedPath],
      })) as typeof dialog.showOpenDialog;
    }, filePath);

    await expectAppReady(page);
    await keepStarterPackEmpty(page);
    await navigateTo(page, views.dictionary);
    await startRendererResponsivenessObserver(page);
    await startMainProcessResponsivenessObserver(app);

    const timings: ResponsiveActionResult[] = [];
    const importButton = page.locator(action(actions.dictionaryImport));
    const preview = page.locator('[data-dialog="dictionary-import-preview"]');
    timings.push(
      await runResponsiveAction({
        label: 'stage 5,000 dictionary rows',
        action: () => importButton.click(),
        probes: [
          attribute('dictionary staging progress', importButton, 'aria-busy', 'true'),
          visible('dictionary import preview', preview),
        ],
      }),
    );
    await expect(preview).toBeVisible({ timeout: 30_000 });
    await expect(preview.locator('[data-import-count="valid"]')).toContainText(String(rowCount));

    const commitButton = page.locator(action(actions.dictionaryImportCommit));
    timings.push(
      await runResponsiveAction({
        label: 'commit 5,000 dictionary rows',
        action: () => commitButton.click(),
        probes: [
          attribute('dictionary batch write progress', preview, 'data-operation-state', 'pending'),
          attribute('dictionary commit button progress', commitButton, 'aria-busy', 'true'),
        ],
      }),
    );
    await expect(preview).toBeHidden({ timeout: 60_000 });

    const finalStableKey = 'term.e2e_bulk_04999';
    const finalResult = page.locator(`[data-palette-term="${finalStableKey}"] ${action(actions.openTerm)}`);
    const palette = page.locator('[data-word-palette]');
    timings.push(
      await runResponsiveAction({
        label: 'search the 5,000-term reference library',
        action: () => page.locator(action(actions.dictionarySearch)).fill('E2E Bulk Term 04999'),
        probes: [
          attribute('large dictionary search progress', palette, 'aria-busy', 'true'),
          visible('last imported term', finalResult),
        ],
      }),
    );
    await expect(finalResult).toBeVisible({ timeout: 30_000 });

    const detail = page.locator('[data-term-detail]');
    timings.push(
      await runResponsiveAction({
        label: 'open a term from 5,000 imported references',
        action: () => finalResult.click(),
        probes: [visible('imported term detail', detail)],
      }),
    );
    await expect(detail).toContainText('E2E Bulk Term 04999');
    expect(stub.requests, 'dictionary import must not call a paid provider').toEqual([]);

    await waitForRendererIdle(page);
    await attachResponsiveActionResults(testInfo, timings);
    await recordRendererResponsiveness(page, testInfo);
    await recordMainProcessResponsiveness(app, testInfo);
  });
});

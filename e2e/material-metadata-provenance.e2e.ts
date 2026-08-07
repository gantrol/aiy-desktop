import type { Locator, Page } from '@playwright/test';
import { expect, test } from './support/app-fixture';
import { expectAppReady, navigateTo } from './support/app-driver';
import { action, actions, views } from './support/selectors';
import { seedMaterialImages } from './support/seed';

async function clickWithMouse(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  if (!box) throw new Error('Expected a visible mouse target');
  const hitTarget = await page.evaluate(
    ({ x, y }) => {
      const hit = document.elementFromPoint(x, y);
      return hit instanceof Element ? hit.closest('[role="option"]')?.textContent?.trim() ?? null : null;
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  if ((await target.getAttribute('role')) === 'option') {
    expect(hitTarget).toBe((await target.textContent())?.trim());
  }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test('selects and persists material model and platform with mouse input inside the inspector sheet', async ({ page }) => {
  // Matches the screenshot's 1875x1153 physical window at 125% display scale.
  await page.setViewportSize({ width: 1500, height: 922 });

  const displayName = 'E2E provenance mouse.png';
  const seeded = await seedMaterialImages(page, [displayName]);
  const materialId = seeded.materialIds[0];
  if (!materialId) throw new Error('Material seed did not return an id');

  await page.evaluate(
    async ({ id, name }) =>
      window.desktopApi.materialMetadataUpdate({
        materialId: id,
        displayName: name,
        note: '',
        sourceUrl: '',
        aiGeneratedStatus: 'YES',
        modelKey: null,
        modelName: '',
        modelProvider: '',
        modelVersion: '',
        generationTextType: 'EXACT_PROMPT',
        generationText: 'E2E prompt',
      }),
    { id: materialId, name: displayName },
  );

  await expectAppReady(page);
  await navigateTo(page, views.gallery);
  await page.locator(action(actions.materialAll)).click();
  const materialCard = page.locator(`[data-material-id="${materialId}"]`).filter({ visible: true }).first();
  await expect(materialCard).toBeVisible();
  await materialCard.click();

  const inspector = page.locator('[data-slot="material-inspector"]');
  await expect(inspector).toBeVisible();
  await inspector.locator(action(actions.materialInspectorDetails)).click();

  const provenanceInputs = inspector.locator('form input[role="combobox"]');
  const modelInput = provenanceInputs.nth(0);
  const platformInput = provenanceInputs.nth(1);

  await clickWithMouse(page, modelInput.locator('..').getByRole('button'));
  const modelOption = page.getByRole('option', { name: 'GPT Image 2', exact: true });
  await clickWithMouse(page, modelOption);
  await expect(modelOption).toBeHidden();
  await expect(inspector).toBeVisible();
  await expect(modelInput).toHaveValue('GPT Image 2');

  await clickWithMouse(page, platformInput.locator('..').getByRole('button'));
  const platformOption = page.getByRole('option', { name: 'Codex', exact: true });
  await clickWithMouse(page, platformOption);
  await expect(platformOption).toBeHidden();
  await expect(inspector).toBeVisible();
  await expect(platformInput).toHaveValue('Codex');

  const save = inspector.locator(action(actions.materialMetadataSave));
  await expect(save).toBeEnabled();
  await save.click();
  await expect(inspector.locator('[data-slot="material-metadata-status"]')).toHaveAttribute('data-state', 'saved');
  await inspector.locator(action(actions.materialInspectorClose)).click();

  await materialCard.click();
  const reopenedInspector = page.locator('[data-slot="material-inspector"]');
  await reopenedInspector.locator(action(actions.materialInspectorDetails)).click();
  const reopenedInputs = reopenedInspector.locator('form input[role="combobox"]');
  await expect(reopenedInputs.nth(0)).toHaveValue('GPT Image 2');
  await expect(reopenedInputs.nth(1)).toHaveValue('Codex');
});

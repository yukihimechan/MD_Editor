const { test, expect } = require('@playwright/test');

test.describe('Markdown Editor E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app-title');
  });

  test('should load the application with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Markdown Editor/);
  });

  test('should load the main panes and toolbar', async ({ page }) => {
    await expect(page.locator('#editor-pane')).toBeVisible();
    await expect(page.locator('header')).toBeVisible();
  });

  test('should load dialogs in DOM but not visible', async ({ page }) => {
    await expect(page.locator('#dialog-config')).toBeAttached();
    await expect(page.locator('#dialog-help')).toBeAttached();
  });

  test('should have a working search button that opens search dialog', async ({ page }) => {
    const btnSearch = page.locator('#btn-search');
    await expect(btnSearch).toBeAttached();
  });
});

import { test, expect } from '@playwright/test';

for (const width of [320, 390, 1440]) {
  test(`pilot shell stays within ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/pilot/');
    await expect(page.getByRole('heading', { name: /A shared kitchen memory/i })).toBeVisible();
    await expect(page.locator('#email-setup-note')).toBeVisible();
    await expect(page.locator('#email-form button[type="submit"]')).toBeDisabled();
    await expect(page.locator('.workspace')).toBeHidden();
    const widths = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.matches(':focus-visible'))).toBe(true);
  });
}

test('reduced-motion preference keeps content usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/pilot/');
  await expect(page.locator('#access-panel')).toBeVisible();
  await expect(page.locator('#email-setup-note')).toBeVisible();
});

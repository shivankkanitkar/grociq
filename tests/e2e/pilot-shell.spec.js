import { test, expect } from '@playwright/test';

for (const width of [320, 390, 1440]) {
  test(`pilot shell stays within ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/app/');
    await expect(page.getByRole('heading', { name: /Your kitchen, under control/i })).toBeVisible();
    await expect(page.locator('#email-setup-note')).toBeVisible();
    await expect(page.locator('#google-sign-in')).toBeDisabled();
    await expect(page.locator('.workspace')).toBeHidden();
    const widths = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.matches(':focus-visible'))).toBe(true);
  });
}

test('reduced-motion preference keeps content usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/app/');
  await expect(page.locator('#access-panel')).toBeVisible();
  await expect(page.locator('#email-setup-note')).toBeVisible();
});

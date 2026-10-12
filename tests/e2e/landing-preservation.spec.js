import { test, expect } from '@playwright/test';

test('public landing navigation, basket and waitlist stay intact', async ({ page }) => {
  await page.route('**/rest/v1/waitlist', route => route.fulfill({ status: 201, body: '' }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Never forget groceries again/i })).toBeVisible();
  await page.getByRole('link', { name: /See How It Works/i }).click();
  await expect(page).toHaveURL(/#how$/);
  await page.locator('.rec-item[data-name="Butter"] .add-btn').click();
  await expect(page.locator('#basketTotal')).toHaveText('₹633');
  await page.locator('#name').fill('Pilot QA');
  await page.locator('#email').fill('pilot-qa@example.test');
  await page.locator('#interest').selectOption({ label: 'Everything' });
  await page.locator('#waitlistForm').getByRole('button', { name: /Join the Waitlist/i }).click();
  await expect(page.locator('#successState')).toBeVisible();
});

test('public waitlist reports a service failure without false success', async ({ page }) => {
  await page.route('**/rest/v1/waitlist', route => route.fulfill({ status: 500, body: '{}' }));
  await page.goto('/');
  await page.locator('#name').fill('Pilot QA');
  await page.locator('#email').fill('pilot-qa@example.test');
  await page.locator('#interest').selectOption({ label: 'Everything' });
  await page.locator('#waitlistForm').getByRole('button', { name: /Join the Waitlist/i }).click();
  await expect(page.locator('#waitlistError')).toBeVisible();
  await expect(page.locator('#successState')).not.toBeVisible();
});

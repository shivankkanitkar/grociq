import { test, expect } from '@playwright/test';

async function mockSignedInHousehold(page) {
  await page.route('**/supabase.min.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.addInitScript(() => {
    const householdId = '11111111-1111-4111-8111-111111111111';
    const userId = '22222222-2222-4222-8222-222222222222';
    const purchaseId = '33333333-3333-4333-8333-333333333333';
    const itemId = '44444444-4444-4444-8444-444444444444';
    const rows = {
      households: [{ id: householdId, name: 'Our kitchen', timezone: 'America/New_York', revision: 1 }],
      household_members: [{ user_id: userId, email: 'pilot@example.test', joined_at: new Date().toISOString() }],
      grocery_items: [{ id: itemId, household_id: householdId, name: 'Milk', essential: true, requested: true,
        availability: 'low', availability_at: new Date().toISOString(), availability_by: userId, revision: 1 }],
      purchases: [{ id: purchaseId, household_id: householdId, merchant: 'Market', purchased_on: '2026-10-11',
        groceries_subtotal_cents: 700, paid_total_cents: 700, delivery_cents: null, service_cents: null,
        tax_cents: null, tip_cents: null, discount_cents: 0, revision: 1, confirmed_by: userId }],
      purchase_lines: [{ purchase_id: purchaseId, item_id: itemId, name_snapshot: 'Milk', quantity: 1, line_total_cents: 700 }]
    };
    const query = table => {
      const builder = { select: () => builder, eq: () => builder, is: () => builder,
        order: () => builder, limit: () => builder,
        single: async () => ({ data: rows[table][0], error: null }),
        then: resolve => Promise.resolve({ data: rows[table], error: null }).then(resolve) };
      return builder;
    };
    window.supabase = { createClient: () => ({
      auth: {
        getSession: async () => ({ data: { session: { user: { id: userId } } } }),
        getUser: async () => ({ data: { user: { id: userId, email: 'pilot@example.test' } }, error: null }),
        signOut: async () => ({ error: null })
      },
      from: query,
      rpc: async (name) => {
        if (name === 'my_household_id') return { data: householdId, error: null };
        if (name === 'get_monthly_budget') return { data: { allowance_cents: 10000, spent_cents: 700,
          purchase_count: 1, revision: 1, updated_at: new Date().toISOString(), updated_by: userId }, error: null };
        return { data: null, error: null };
      }
    }) };
  });
}

test('returning partner can see shared data and choose a useful basket addition', async ({ page }) => {
  await mockSignedInHousehold(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/pilot/');
  await expect(page.getByText('Our kitchen')).toBeVisible();
  await page.getByRole('button', { name: 'Groceries', exact: true }).click();
  await expect(page.locator('#grocery-list')).toContainText('Milk');
  await page.getByRole('button', { name: 'Budget', exact: true }).click();
  await expect(page.locator('#budget-summary')).toContainText('$93.00');
  await page.getByRole('button', { name: 'Pre-order check' }).click();
  await page.locator('#basket-groceries').fill('43.00');
  await page.locator('#basket-threshold').fill('50.00');
  await page.getByRole('button', { name: 'Check my basket' }).click();
  await expect(page.locator('#suggestion-list')).toContainText('Milk');
  await page.getByLabel('Add to my plan').check();
  await expect(page.locator('#check-summary')).toContainText('$50.00');
  const widths = await page.evaluate(() => ({ client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
});

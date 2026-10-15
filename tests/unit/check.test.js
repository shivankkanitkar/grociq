import test from 'node:test';
import assert from 'node:assert/strict';
import { refillSuggestions, checkBasket } from '../../pilot/js/check.js';

const base = { purchases: [], lines: [] };
test('a new household gets explicit needs, never a learned-cadence claim', () => {
  const data = { ...base, items: [
    { id: 'milk', name: 'Milk', availability: 'low', availability_at: '2026-10-12T12:00:00Z', requested: false, essential: true },
    { id: 'bread', name: 'Bread', availability: 'unknown', requested: false, essential: false }
  ] };
  const result = refillSuggestions(data, '2026-10-12', 'America/New_York');
  assert.equal(result.length, 1);
  assert.match(result[0].reason, /Marked running low/);
  assert.equal(result[0].cadence_days, null);
});

test('three dated purchases can suggest a check; later availability postpones it', () => {
  const dates = ['2026-09-01','2026-09-08','2026-09-15'];
  const data = { items: [{ id: 'milk', name: 'Milk', availability: 'unknown', requested: false, essential: true }],
    purchases: dates.map((date, i) => ({ id: `p${i}`, purchased_on: date })),
    lines: dates.map((_, i) => ({ item_id: 'milk', purchase_id: `p${i}`, line_total_cents: 450 })) };
  assert.equal(refillSuggestions(data, '2026-09-22', 'America/New_York')[0].cadence_days, 7);
  data.items[0].availability = 'available';
  data.items[0].availability_at = '2026-09-21T16:00:00Z';
  assert.equal(refillSuggestions(data, '2026-09-22', 'America/New_York').length, 0);
  assert.match(refillSuggestions(data, '2026-09-28', 'America/New_York')[0].reason, /Check if needed/);
});

test('confirmed stock at the refill point is useful unless a newer purchase makes it stale', () => {
  const item = { id: 'oats', name: 'Oats', availability: 'unknown', requested: false, essential: true,
    quantity_on_hand: '1.00', quantity_unit: 'pack', refill_at: '1.00',
    quantity_confirmed_at: '2026-10-12T14:00:00Z' };
  const data = { items: [item], purchases: [], lines: [] };
  assert.match(refillSuggestions(data, '2026-10-12', 'America/New_York')[0].reason, /1 pack left/);
  data.purchases.push({ id: 'later', purchased_on: '2026-10-13' });
  data.lines.push({ item_id: 'oats', purchase_id: 'later', line_total_cents: 600 });
  assert.equal(refillSuggestions(data, '2026-10-13', 'America/New_York').length, 0);
});

test('threshold and budget use chosen useful additions only', () => {
  const suggestions = [{ id:'milk', estimated_cents:700, essential:true }, { id:'chips', estimated_cents:300, essential:false }];
  const result = checkBasket({ groceriesCents:4300, thresholdCents:5000, charges:[null,null,null,null] },
    suggestions, new Set(['milk']), new Set(), 4000);
  assert.equal(result.projectedGroceries, 5000);
  assert.equal(result.gap, 0);
  assert.equal(result.complete, false);
  assert.equal(result.remainingAfter, -1000);
  assert.deepEqual(result.mayPostpone, []);
  assert.equal(checkBasket({ groceriesCents:4300, thresholdCents:5000, charges:[0,0,0,0] },
    [], new Set(), new Set(), null).additions.length, 0);
});

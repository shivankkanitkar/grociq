import test from 'node:test';
import assert from 'node:assert/strict';
import { cents, dollars, purchasePayload } from '../../pilot/js/groceries.js';

test('currency input uses exact cents and never rounds a float', () => {
  assert.equal(cents('12.05'), 1205);
  assert.equal(cents('0.1'), 10);
  assert.equal(cents('', { optional: true }), null);
  assert.equal(dollars(1205), '$12.05');
  assert.throws(() => cents('12.345'));
  assert.throws(() => cents('-1'));
});

test('a reviewed shop keeps unknown fees unknown and one paid total', () => {
  const payload = purchasePayload({ merchant: 'Market', date: '2026-10-12', paid: '95',
    discount: '0', delivery: '5', service: '3', tax: '2', tip: '5' },
  [{ name: 'Groceries', quantity: '1', price: '80' }]);
  assert.equal(payload.groceries_subtotal_cents, 8000);
  assert.equal(payload.paid_total_cents, 9500);
  assert.equal(payload.tip_cents, 500);
  const incomplete = purchasePayload({ merchant: 'Market', date: '2026-10-12', paid: '85',
    delivery: '5', service: '', tax: '', tip: '' },
  [{ name: 'Groceries', quantity: '1', price: '80' }]);
  assert.equal(incomplete.tax_cents, null);
  assert.throws(() => purchasePayload({ merchant: 'Market', date: '2026-10-12', paid: '81',
    delivery: '5' }, [{ name: 'Groceries', quantity: '1', price: '80' }]));
});

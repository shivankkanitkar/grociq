import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptReviewDraft, receiptTextDraft, validateReceiptFile } from '../../pilot/js/receipts.js';

test('receipt text creates only editable suggestions', () => {
  const draft = receiptTextDraft('FRESH MARKET\n10/12/2026\nMILK 2% 4.29\nBANANAS 1.79\nSUBTOTAL 6.08\nTAX 0.00\nTOTAL $6.08');
  assert.deepEqual(draft, { merchant: 'FRESH MARKET', date: '2026-10-12', paid: '6.08', lines: [
    { name: 'MILK 2%', quantity: '1', price: '4.29' },
    { name: 'BANANAS', quantity: '1', price: '1.79' }
  ] });
});

test('a synthetic receipt becomes an editable, unconfirmed draft', () => {
  const result = receiptReviewDraft({ analyzeResult: { documents: [{ docType: 'receipt', fields: {
    MerchantName: { valueString: 'Example Market', confidence: 0.99 },
    TransactionDate: { valueDate: '2026-10-12', confidence: 0.97 },
    Total: { valueCurrency: { amount: 6.48 }, confidence: 0.98 },
    TotalTax: { valueCurrency: { amount: 0.48 }, confidence: 0.93 },
    Items: { valueArray: [{ valueObject: {
      Description: { valueString: 'Milk', confidence: 0.95 },
      Quantity: { valueNumber: 1, confidence: 0.9 },
      TotalPrice: { valueCurrency: { amount: 6 }, confidence: 0.96 }
    } }] }
  } }] } });
  assert.equal(result.paid, '6.48');
  assert.equal(result.lines[0].name, 'Milk');
  assert.equal(result.lines[0].price, '6.00');
  assert.equal(result.review.items, false);
  assert.equal(result.review.paid, false);
  assert.equal(Object.hasOwn(result, 'purchase_id'), false);
});

test('uncertain and missing fields stay visibly incomplete, never invented as zero', () => {
  const result = receiptReviewDraft({ analyzeResult: { documents: [{ fields: {
    MerchantName: { valueString: '<script>', confidence: 0.35 },
    Items: { valueArray: [{ valueObject: {
      Description: { valueString: 'Oats', confidence: 0.7 }
    } }] }
  } }] } });
  assert.equal(result.paid, '');
  assert.equal(result.lines[0].price, '');
  assert.equal(result.review.merchant, true);
  assert.equal(result.review.items, true);
  assert.equal(result.merchant, '<script>'); // UI must render via textContent, never innerHTML.
});

test('an unreadable result preserves the manual-entry path', () => {
  assert.throws(() => receiptReviewDraft({ analyzeResult: { documents: [] } }), /Enter this purchase manually/);
});

test('the file gate checks size and actual JPEG or PNG bytes', () => {
  assert.equal(validateReceiptFile({ size: 512, type: 'image/png' }, new Uint8Array([137,80,78,71,13,10,26,10])), true);
  assert.throws(() => validateReceiptFile({ size: 512, type: 'image/png' }, new Uint8Array([60,104,116,109,108,62,0,0])), /JPEG or PNG/);
  assert.throws(() => validateReceiptFile({ size: 4 * 1024 * 1024 + 1, type: 'image/jpeg' }, new Uint8Array([255,216,255])), /under 4 MB/);
});

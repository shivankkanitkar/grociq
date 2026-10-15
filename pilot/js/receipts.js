// The OCR result is an untrusted suggestion. Callers must show every field for review;
// this module never uploads a file or confirms a purchase.
const LIMIT_BYTES = 4 * 1024 * 1024;
const MIN_CONFIDENCE = 0.8;

export function validateReceiptFile(file, header) {
  if (!file || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > LIMIT_BYTES) {
    throw new Error('Choose one receipt image under 4 MB.');
  }
  const bytes = header instanceof Uint8Array ? header : new Uint8Array(header || []);
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((part, index) => bytes[index] === part);
  if ((file.type === 'image/jpeg' && jpeg) || (file.type === 'image/png' && png)) return true;
  throw new Error('Use a JPEG or PNG receipt image. Other files can be entered manually.');
}

// Conservative US receipt-text extraction. Ambiguous values remain blank for review.
export function receiptTextDraft(rawText) {
  const rows = String(rawText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!rows.length) throw new Error('No readable text was found. Enter this purchase manually.');
  const merchant = rows.find(line => /[a-z]{3}/i.test(line) && !/^(receipt|thank you|date|total|subtotal)/i.test(line))?.slice(0, 100) || '';
  const dateText = rows.join(' ').match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  let date = '';
  if (dateText) {
    const month = Number(dateText[1]); const day = Number(dateText[2]); const year = Number(dateText[3]);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day) {
      date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  const totalCandidates = rows.filter(line => /\b(total|amount paid|balance due)\b/i.test(line) && !/sub\s?total/i.test(line));
  const totalLine = totalCandidates.at(-1) || '';
  const totalMatch = totalLine.match(/\$?\s?(\d{1,5}[.,]\d{2})\s*$/);
  const paid = totalMatch ? totalMatch[1].replace(',', '.') : '';
  const lines = rows.flatMap(row => {
    if (/\b(sub\s?total|total|tax|change|cash|card|visa|mastercard|date|receipt|savings|discount|balance|payment)\b/i.test(row)) return [];
    const match = row.match(/^(.{3,80}?)\s+\$?(\d{1,5}[.,]\d{2})\s*$/);
    if (!match || !/[a-z]/i.test(match[1])) return [];
    return [{ name: match[1].replace(/^\d+\s+/, '').trim().slice(0, 100), quantity: '1', price: match[2].replace(',', '.') }];
  }).slice(0, 40);
  return { merchant, date, paid, lines };
}

function fieldText(field) {
  return String(field?.valueString ?? field?.valueDate ?? '').trim();
}

function amount(field) {
  const value = field?.valueCurrency?.amount ?? field?.valueNumber;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '';
  // Azure supplies decimal currency values; reject sub-cent or unsafe values.
  const pennies = Math.round(value * 100);
  if (!Number.isSafeInteger(pennies) || Math.abs(value * 100 - pennies) > 0.00001) return '';
  return (pennies / 100).toFixed(2);
}

function needsReview(field, value) {
  return !value || typeof field?.confidence !== 'number' || field.confidence < MIN_CONFIDENCE;
}

export function receiptReviewDraft(response) {
  const document = response?.analyzeResult?.documents?.find(entry => entry?.docType === 'receipt')
    ?? response?.analyzeResult?.documents?.[0];
  if (!document?.fields || typeof document.fields !== 'object') {
    throw new Error('No receipt fields were found. Enter this purchase manually.');
  }
  const fields = document.fields;
  const merchant = fieldText(fields.MerchantName);
  const date = fieldText(fields.TransactionDate);
  const paid = amount(fields.Total);
  const taxField = fields.TotalTax ?? fields.Tax;
  const tax = amount(taxField);
  const tip = amount(fields.Tip);
  const items = Array.isArray(fields.Items?.valueArray) ? fields.Items.valueArray : [];
  const lines = items.map(entry => {
    const source = entry?.valueObject || {};
    const nameField = source.Description ?? source.Name;
    const name = fieldText(nameField);
    const quantity = source.Quantity?.valueNumber;
    const priceField = source.TotalPrice;
    const price = amount(priceField);
    return {
      name,
      quantity: typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0 ? String(quantity) : '1',
      price,
      review: needsReview(nameField, name) || needsReview(priceField, price)
        || (source.Quantity != null && needsReview(source.Quantity, quantity))
    };
  });
  return {
    merchant, date, paid, tax, tip, lines,
    review: {
      merchant: needsReview(fields.MerchantName, merchant),
      date: needsReview(fields.TransactionDate, date) || !/^\d{4}-\d{2}-\d{2}$/.test(date),
      paid: needsReview(fields.Total, paid),
      tax: taxField != null && needsReview(taxField, tax),
      tip: fields.Tip != null && needsReview(fields.Tip, tip),
      items: !lines.length || lines.some(line => line.review)
    }
  };
}

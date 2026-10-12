const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function dollars(cents) {
  return cents == null ? 'Not entered' : usd.format(cents / 100);
}

export function cents(value, { optional = false } = {}) {
  const clean = String(value ?? '').trim();
  if (!clean && optional) return null;
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(clean)) {
    throw new Error('Enter dollar amounts with up to two decimals.');
  }
  const [whole, fraction = ''] = clean.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function purchasePayload(fields, rows) {
  if (!rows.length) throw new Error('Add at least one purchased item.');
  const lines = rows.map(({ name, quantity, price }) => {
    const cleanName = String(name || '').trim();
    const count = Number(quantity);
    if (!cleanName || cleanName.length > 100 || !Number.isFinite(count) || count <= 0 || count > 999) {
      throw new Error('Review every item name and quantity.');
    }
    return { name: cleanName, quantity: count, line_total_cents: cents(price) };
  });
  const discount = cents(fields.discount || '0');
  const sum = lines.reduce((total, line) => total + line.line_total_cents, 0);
  const subtotal = sum - discount;
  if (subtotal < 0) throw new Error('Discount cannot exceed the item prices.');
  const payload = {
    merchant: String(fields.merchant || '').trim(),
    purchased_on: fields.date,
    lines,
    discount_cents: discount,
    groceries_subtotal_cents: subtotal,
    delivery_cents: cents(fields.delivery, { optional: true }),
    service_cents: cents(fields.service, { optional: true }),
    tax_cents: cents(fields.tax, { optional: true }),
    tip_cents: cents(fields.tip, { optional: true }),
    paid_total_cents: cents(fields.paid)
  };
  if (!payload.merchant || payload.merchant.length > 100 || !/^\d{4}-\d{2}-\d{2}$/.test(payload.purchased_on || '')) {
    throw new Error('Enter a merchant and purchase date.');
  }
  const knownCharges = [payload.delivery_cents, payload.service_cents, payload.tax_cents, payload.tip_cents]
    .reduce((total, amount) => total + (amount || 0), 0);
  if (subtotal + knownCharges > payload.paid_total_cents) {
    throw new Error('The paid total is below the groceries and known charges.');
  }
  const complete = [payload.delivery_cents, payload.service_cents, payload.tax_cents, payload.tip_cents]
    .every(amount => amount !== null);
  if (complete && subtotal + knownCharges !== payload.paid_total_cents) {
    throw new Error('The complete breakdown must equal the paid total.');
  }
  return payload;
}

export async function loadGroceries(client, householdId) {
  const [items, purchases, lines] = await Promise.all([
    client.from('grocery_items').select('*').eq('household_id', householdId).order('name'),
    client.from('purchases').select('*').eq('household_id', householdId).is('voided_at', null).order('purchased_on', { ascending: false }).limit(200),
    client.from('purchase_lines').select('purchase_id,item_id,name_snapshot,quantity,line_total_cents').eq('household_id', householdId)
  ]);
  for (const result of [items, purchases, lines]) if (result.error) throw result.error;
  return { items: items.data, purchases: purchases.data, lines: lines.data };
}

export async function addItem(client, name, essential) {
  const { data, error } = await client.rpc('add_grocery_item', { p_name: name, p_essential: essential });
  if (error) throw error;
  return data;
}

export async function saveItemState(client, item, state) {
  const { data, error } = await client.rpc('set_grocery_state', {
    p_item_id: item.id, p_expected_revision: item.revision,
    p_availability: state.availability, p_requested: state.requested, p_essential: state.essential
  });
  if (error) throw error;
  return data;
}

export async function savePurchase(client, payload, operationId, options = {}) {
  const { data, error } = await client.rpc('confirm_purchase', {
    p_payload: payload, p_operation_id: operationId,
    p_replace_purchase_id: options.replaceId || null,
    p_expected_revision: options.expectedRevision || null,
    p_distinct_candidate_ids: options.distinctCandidateIds || []
  });
  if (error) throw error;
  return data;
}

export async function voidPurchase(client, purchase) {
  const { data, error } = await client.rpc('void_purchase', {
    p_purchase_id: purchase.id, p_expected_revision: purchase.revision
  });
  if (error) throw error;
  return data;
}

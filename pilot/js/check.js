function dayNumber(date) {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function localDate(timestamp, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(timestamp));
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function refillSuggestions(data, today, timezone) {
  const purchaseById = new Map(data.purchases.map(purchase => [purchase.id, purchase]));
  return data.items.map(item => {
    const bought = data.lines.filter(line => line.item_id === item.id && purchaseById.has(line.purchase_id))
      .map(line => ({ date: purchaseById.get(line.purchase_id).purchased_on, line_total_cents: line.line_total_cents }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const dates = [...new Set(bought.map(entry => entry.date))];
    const intervals = dates.slice(1).map((date, index) => dayNumber(date) - dayNumber(dates[index])).filter(days => days > 0);
    const cadence = dates.length >= 3 && intervals.length >= 2 ? median(intervals.slice(-5)) : null;
    const lastPurchase = bought.at(-1) || null;
    const lastStatusDate = item.availability_at ? localDate(item.availability_at, timezone) : null;
    const statusCurrent = lastStatusDate && (!lastPurchase || dayNumber(lastStatusDate) >= dayNumber(lastPurchase.date));
    let reason = null;
    let priority = 10;
    if (item.availability === 'finished' && statusCurrent) { reason = 'Marked finished by your household'; priority = 0; }
    else if (item.availability === 'low' && statusCurrent) { reason = 'Marked running low by your household'; priority = 1; }
    else if (item.requested) { reason = 'On your shared next list'; priority = 2; }
    else if (cadence && lastPurchase) {
      const referenceDay = item.availability === 'available' && lastStatusDate && dayNumber(lastStatusDate) > dayNumber(lastPurchase.date)
        ? dayNumber(lastStatusDate) : dayNumber(lastPurchase.date);
      if (dayNumber(today) >= referenceDay + cadence) {
        reason = item.availability === 'available' && lastStatusDate && dayNumber(lastStatusDate) > dayNumber(lastPurchase.date)
          ? `It has been about ${cadence} days since you confirmed it was available. Check if needed.`
          : `Usually bought about every ${cadence} days. Check if needed.`;
        priority = 3;
      }
    }
    if (!reason) return null;
    return {
      id: item.id, name: item.name, essential: item.essential, reason, priority,
      estimated_cents: lastPurchase?.line_total_cents ?? null,
      price_date: lastPurchase?.date ?? null, cadence_days: cadence
    };
  }).filter(Boolean).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

export function checkBasket({ groceriesCents, thresholdCents, charges }, suggestions, selectedIds, alreadyIds, remainingCents) {
  const additions = suggestions.filter(item => selectedIds.has(item.id) && !alreadyIds.has(item.id));
  const unknownAdditions = additions.filter(item => item.estimated_cents == null);
  const addedCents = additions.reduce((sum, item) => sum + (item.estimated_cents || 0), 0);
  const projectedGroceries = groceriesCents + addedCents;
  const knownCharges = charges.reduce((sum, amount) => sum + (amount || 0), 0);
  const complete = unknownAdditions.length === 0 && charges.every(amount => amount != null);
  const projectedMinimum = projectedGroceries + knownCharges;
  const gap = thresholdCents == null ? null : Math.max(0, thresholdCents - projectedGroceries);
  return {
    additions, unknownAdditions, projectedGroceries, projectedMinimum, complete, gap,
    remainingAfter: remainingCents == null ? null : remainingCents - projectedMinimum,
    mayPostpone: additions.filter(item => !item.essential)
  };
}

export function householdToday(timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now);
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function monthStart(localDate) {
  return `${localDate.slice(0, 7)}-01`;
}

export function weeklyGuidance(allowanceCents, spentCents, localDate) {
  if (allowanceCents == null) return null;
  const remaining = allowanceCents - spentCents;
  if (remaining <= 0) return { remaining, guidance: 0, daysLeft: 0 };
  const [year, month, day] = localDate.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const daysLeft = lastDay - day + 1;
  const guidance = Math.round(remaining * Math.min(7, daysLeft) / daysLeft);
  return { remaining, guidance, daysLeft };
}

export async function loadBudget(client, month) {
  const { data, error } = await client.rpc('get_monthly_budget', { p_month: month });
  if (error) throw error;
  return data;
}

export async function saveBudget(client, month, allowanceCents, revision) {
  const { data, error } = await client.rpc('set_monthly_budget', {
    p_month: month, p_allowance_cents: allowanceCents, p_expected_revision: revision ?? null
  });
  if (error) throw error;
  return data;
}

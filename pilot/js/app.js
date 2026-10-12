import { resolvePilotConfig } from './config.js?v=20261012';
import { createPilotClient, sendEmailCode, verifyEmailCode, loadMembership, createHousehold, acceptInvite, createInvite, revokeInvite, leaveHousehold, inviteLink } from './auth.js';
import { cents, dollars, purchasePayload, loadGroceries, addItem, saveItemState, savePurchase, voidPurchase } from './groceries.js';
import { householdToday, monthStart, weeklyGuidance, loadBudget, saveBudget } from './budget.js';
import { refillSuggestions, checkBasket } from './check.js';

const $ = (selector) => document.querySelector(selector);
const serviceStatus = $('#service-status');
const accessPanel = $('#access-panel');
const householdPanel = $('#household-panel');
const memberBar = $('#member-bar');
const workspace = $('.workspace');
const invitePanel = $('#invite-panel');
const privacyPanel = $('#privacy-panel');
const config = resolvePilotConfig(window.location.hostname);
const inviteFromUrl = new URL(window.location.href).searchParams.get('invite');
if (inviteFromUrl) {
  const clean = new URL(window.location.href);
  clean.searchParams.delete('invite');
  window.history.replaceState({}, '', clean);
  $('#invite-token').value = inviteFromUrl;
}

let client;
let currentUser;
let household;
let lastRefresh;
let groceryData = { items: [], purchases: [], lines: [] };
let editingPurchase = null;
let pendingPurchase = null;
let budgetData = null;
let checkInputs = null;
let checkSuggestions = [];
let checkSelected = new Set();
let checkAlready = new Set();

function clearPrivateState() {
  household = null;
  groceryData = { items: [], purchases: [], lines: [] };
  editingPurchase = null;
  pendingPurchase = null;
  budgetData = null;
  checkInputs = null;
  checkSuggestions = [];
  checkSelected = new Set();
  checkAlready = new Set();
  $('#check-results').hidden = true;
  $('#grocery-list').replaceChildren();
  $('#purchase-history').replaceChildren();
  $('#budget-summary').replaceChildren();
  $('#suggestion-list').replaceChildren();
  $('#monthly-allowance').value = '';
  $('#active-household-name').textContent = '';
  $('#member-summary').textContent = '';
  resetPurchaseForm();
}

function setStatus(node, message, isError = false) {
  node.hidden = false;
  node.textContent = message;
  node.dataset.state = isError ? 'error' : 'ok';
}

function showOnly(section) {
  accessPanel.hidden = section !== 'access';
  householdPanel.hidden = section !== 'household';
  memberBar.hidden = section !== 'workspace';
  workspace.hidden = section !== 'workspace';
  privacyPanel.hidden = section !== 'workspace';
  if (section !== 'workspace') invitePanel.hidden = true;
}

function showView(name) {
  const next = document.querySelector(`#view-${name}`);
  if (!next) return;
  for (const view of document.querySelectorAll('.view')) {
    const active = view === next;
    view.hidden = !active;
    view.classList.toggle('is-visible', active);
  }
  for (const tab of document.querySelectorAll('.nav-tab')) {
    const active = tab.dataset.view === name;
    tab.classList.toggle('is-active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content != null) node.textContent = content;
  return node;
}

function partnerName(userId) {
  return household?.members.find(member => member.user_id === userId)?.email || 'A partner';
}

function renderItems() {
  const list = $('#grocery-list');
  list.replaceChildren();
  if (!groceryData.items.length) {
    const empty = element('div', 'empty-card');
    empty.append(element('h3', '', 'Nothing on the list yet'), element('p', '', 'Add the first grocery you and your partner want to remember.'));
    list.append(empty);
    return;
  }
  for (const item of groceryData.items) {
    const card = element('form', 'record-card grocery-record');
    const info = element('div', 'record-info');
    info.append(element('strong', '', item.name), element('small', '', item.availability_at
      ? `Availability confirmed by ${partnerName(item.availability_by)} · ${new Date(item.availability_at).toLocaleString()}`
      : 'Availability not confirmed yet'));
    const controls = element('div', 'item-controls');
    const select = element('select');
    select.setAttribute('aria-label', `${item.name} availability`);
    for (const [value, label] of [['unknown','Not checked'],['available','Still available'],['low','Running low'],['finished','Finished']]) {
      const option = element('option', '', label);
      option.value = value;
      select.append(option);
    }
    select.value = item.availability;
    const requestedLabel = element('label', 'checkbox-label', 'On next list');
    const requested = element('input'); requested.type = 'checkbox'; requested.checked = item.requested;
    requestedLabel.prepend(requested);
    const essentialLabel = element('label', 'checkbox-label', 'Essential');
    const essential = element('input'); essential.type = 'checkbox'; essential.checked = item.essential;
    essentialLabel.prepend(essential);
    const button = element('button', 'outline-button', 'Save update'); button.type = 'submit';
    controls.append(select, requestedLabel, essentialLabel, button);
    card.append(info, controls);
    card.addEventListener('submit', async (event) => {
      event.preventDefault(); button.disabled = true;
      try {
        await saveItemState(client, item, { availability: select.value, requested: requested.checked, essential: essential.checked });
        setStatus($('#item-status'), `${item.name} updated for both partners.`);
        await refreshHousehold();
      } catch (error) {
        setStatus($('#item-status'), error.message || 'Could not save this update.', true);
      } finally { button.disabled = false; }
    });
    list.append(card);
  }
}

function renderPurchases() {
  const history = $('#purchase-history');
  history.replaceChildren();
  if (!groceryData.purchases.length) {
    const empty = element('div', 'empty-card');
    empty.append(element('h3', '', 'No purchases confirmed yet'), element('p', '', 'Your reviewed purchases will appear here for both partners.'));
    history.append(empty);
    return;
  }
  for (const purchase of groceryData.purchases.slice(0, 15)) {
    const card = element('article', 'record-card purchase-record');
    const heading = element('div', 'purchase-record-heading');
    const headingText = element('div');
    headingText.append(element('strong', '', purchase.merchant), element('small', '', `${purchase.purchased_on} · Confirmed by ${partnerName(purchase.confirmed_by)}`));
    heading.append(headingText, element('b', '', dollars(purchase.paid_total_cents)));
    const lineNames = groceryData.lines.filter(line => line.purchase_id === purchase.id).map(line => line.name_snapshot);
    const details = element('p', '', `${lineNames.join(', ')} · Groceries ${dollars(purchase.groceries_subtotal_cents)}`);
    const feeFields = [purchase.delivery_cents, purchase.service_cents, purchase.tax_cents, purchase.tip_cents];
    const note = element('small', 'breakdown-note', feeFields.some(amount => amount == null)
      ? 'Some fee components were not entered; the paid total is confirmed.'
      : 'Groceries and all extra charges were entered.');
    const actions = element('div', 'record-actions');
    const correct = element('button', 'quiet-button', 'Correct'); correct.type = 'button';
    correct.addEventListener('click', () => editPurchase(purchase));
    const remove = element('button', 'quiet-button danger', 'Void'); remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (!window.confirm(`Void the ${purchase.merchant} purchase from ${purchase.purchased_on}? Its paid total will stop counting toward spending.`)) return;
      try {
        await voidPurchase(client, purchase);
        setStatus($('#purchase-status'), 'Purchase voided. Spending will be recalculated from confirmed records.');
        await refreshHousehold();
      } catch (error) { setStatus($('#purchase-status'), error.message || 'Could not void purchase.', true); }
    });
    actions.append(correct, remove);
    card.append(heading, details, note, actions);
    history.append(card);
  }
}

function renderWorkspace() {
  renderItems(); renderPurchases();
  const pill = $('#view-home .state-pill');
  pill.textContent = groceryData.purchases.length
    ? `${groceryData.purchases.length} recent confirmed ${groceryData.purchases.length === 1 ? 'purchase' : 'purchases'}`
    : 'No purchases confirmed yet';
  if (checkInputs) {
    checkSuggestions = refillSuggestions(groceryData, householdToday(household.timezone), household.timezone);
    renderCheck();
  }
}

function renderCheck() {
  if (!checkInputs) return;
  $('#check-results').hidden = false;
  const list = $('#suggestion-list'); list.replaceChildren();
  if (!checkSuggestions.length) {
    const empty = element('div', 'empty-card');
    empty.append(element('h3', '', 'Nothing useful to add right now'),
      element('p', '', 'There are no confirmed low items, shared-list requests or supported refill checks. GrocIQ will not suggest filler to reach a threshold.'));
    list.append(empty);
  }
  for (const item of checkSuggestions) {
    const card = element('article', 'record-card suggestion-card');
    const info = element('div');
    info.append(element('strong', '', item.name), element('p', '', item.reason),
      element('small', '', item.estimated_cents == null ? 'No price history yet' : `Last paid ${dollars(item.estimated_cents)} on ${item.price_date} · estimate`));
    const actions = element('div', 'suggestion-actions');
    const alreadyLabel = element('label', 'checkbox-label', 'Already in my order');
    const already = element('input'); already.type = 'checkbox'; already.checked = checkAlready.has(item.id); alreadyLabel.prepend(already);
    const addLabel = element('label', 'checkbox-label', 'Add to my plan');
    const add = element('input'); add.type = 'checkbox'; add.checked = checkSelected.has(item.id); add.disabled = already.checked; addLabel.prepend(add);
    already.addEventListener('change', () => {
      if (already.checked) { checkAlready.add(item.id); checkSelected.delete(item.id); add.checked = false; }
      else checkAlready.delete(item.id);
      add.disabled = already.checked; updateCheckSummary();
    });
    add.addEventListener('change', () => {
      if (add.checked) checkSelected.add(item.id); else checkSelected.delete(item.id);
      updateCheckSummary();
    });
    actions.append(alreadyLabel, addLabel);
    card.append(info, actions); list.append(card);
  }
  updateCheckSummary();
}

function updateCheckSummary() {
  if (!checkInputs) return;
  const remaining = budgetData?.allowance_cents == null ? null : budgetData.allowance_cents - budgetData.spent_cents;
  const result = checkBasket(checkInputs, checkSuggestions, checkSelected, checkAlready, remaining);
  const summary = $('#check-summary'); summary.replaceChildren();
  const grid = element('div', 'check-metrics');
  const metrics = [
    ['Planned groceries', `${result.unknownAdditions.length ? 'At least ' : ''}${dollars(result.projectedGroceries)}`],
    ['Threshold gap', result.gap == null ? 'Not entered' : result.gap === 0 ? 'At or above entered amount' : `${dollars(result.gap)} to entered amount`],
    ['Projected all-in', `${result.complete ? '' : 'At least '}${dollars(result.projectedMinimum)}`]
  ];
  for (const [label, value] of metrics) {
    const tile = element('div', 'budget-metric'); tile.append(element('small', '', label), element('strong', '', value)); grid.append(tile);
  }
  summary.append(grid);
  if (!result.complete) summary.append(element('p', 'form-explainer', 'This is incomplete: blank charges or selected items without a past price are not assumed to cost $0.'));
  if (result.remainingAfter != null) {
    if (result.remainingAfter < 0) {
      const warning = element('p', 'check-warning', `This plan is at least ${dollars(-result.remainingAfter)} above your remaining monthly allowance.`);
      summary.append(warning);
      summary.append(element('p', 'form-explainer', result.mayPostpone.length
        ? `You could postpone a nonessential planned addition such as ${result.mayPostpone.map(item => item.name).join(', ')}. Keep needed essentials if you choose.`
        : 'No selected optional addition is marked nonessential. Review your external basket yourself; GrocIQ cannot see what is inside it.'));
    } else summary.append(element('p', 'check-ok', `${dollars(result.remainingAfter)} remains after this minimum projected cost. Unknown charges may change it.`));
  } else summary.append(element('p', 'form-explainer', 'Set a monthly budget to compare this plan with your household allowance.'));
}

function currentMonth() {
  return monthStart(householdToday(household.timezone));
}

function renderBudget() {
  const view = $('#budget-summary');
  view.replaceChildren();
  if (!budgetData || budgetData.allowance_cents == null) {
    const empty = element('div', 'empty-card');
    empty.append(element('h3', '', 'No budget set for this month'), element('p', '', 'Add a household allowance below. No affordability claim is shown until you do.'));
    view.append(empty);
    $('#monthly-allowance').value = '';
    return;
  }
  const localDate = householdToday(household.timezone);
  const guide = weeklyGuidance(budgetData.allowance_cents, budgetData.spent_cents, localDate);
  const grid = element('div', 'budget-metrics');
  for (const [label, value] of [['Month allowance',dollars(budgetData.allowance_cents)],
    ['Confirmed spending',dollars(budgetData.spent_cents)],
    [guide.remaining < 0 ? 'Over by' : 'Remaining',dollars(Math.abs(guide.remaining))],
    ['Next-seven-days guide',dollars(guide.guidance)]]) {
    const card = element('div', 'budget-metric');
    card.append(element('small', '', label), element('strong', '', value));
    grid.append(card);
  }
  const progress = element('div', 'budget-track');
  const fill = element('div', 'budget-fill');
  fill.style.width = `${Math.min(100, budgetData.allowance_cents ? budgetData.spent_cents / budgetData.allowance_cents * 100 : 100)}%`;
  if (guide.remaining < 0) fill.classList.add('over');
  progress.append(fill);
  const note = element('p', 'budget-note', guide.remaining < 0
    ? `You are ${dollars(-guide.remaining)} over this month's allowance. No further weekly allowance is suggested.`
    : `${budgetData.purchase_count} confirmed ${budgetData.purchase_count === 1 ? 'purchase' : 'purchases'} this month. The weekly figure is guidance, not a spending limit.`);
  const updated = element('small', 'breakdown-note', `Allowance last updated by ${partnerName(budgetData.updated_by)} · ${new Date(budgetData.updated_at).toLocaleString()}`);
  view.append(grid, progress, note, updated);
  $('#monthly-allowance').value = (budgetData.allowance_cents / 100).toFixed(2);
  if (checkInputs) updateCheckSummary();
}

async function refreshBudget() {
  try {
    budgetData = await loadBudget(client, currentMonth());
    renderBudget();
  } catch (error) {
    serviceStatus.hidden = false;
    serviceStatus.dataset.state = 'unavailable';
    serviceStatus.textContent = 'The budget could not be refreshed. The last view may be stale.';
    console.error('Budget refresh failed', error);
  }
}

async function refreshGroceries() {
  try {
    groceryData = await loadGroceries(client, household.id);
    renderWorkspace();
  } catch (error) {
    serviceStatus.hidden = false;
    serviceStatus.dataset.state = 'unavailable';
    serviceStatus.textContent = 'Grocery records could not be refreshed. The last view may be stale; no changes were made.';
    console.error('Grocery refresh failed', error);
  }
}

workspace.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-view], [data-open]');
  if (trigger) showView(trigger.dataset.view || trigger.dataset.open);
});

async function refreshHousehold() {
  if (!client) return;
  const { data: { session } } = await client.auth.getSession();
  if (!session) {
    currentUser = null;
    clearPrivateState();
    showOnly('access');
    serviceStatus.hidden = true;
    return;
  }
  const { data: { user }, error } = await client.auth.getUser();
  if (error && error.status !== 401 && error.status !== 403) {
    serviceStatus.dataset.state = 'unavailable';
    serviceStatus.textContent = 'Cannot reach your household right now. The last view may be stale; try Refresh.';
    return;
  }
  currentUser = user || null;
  if (!currentUser) {
    clearPrivateState();
    showOnly('access');
    serviceStatus.hidden = true;
    return;
  }
  try {
    const nextHousehold = await loadMembership(client);
    if (household?.id && household.id !== nextHousehold?.id) clearPrivateState();
    household = nextHousehold;
    lastRefresh = new Date();
    serviceStatus.hidden = true;
    if (!household) {
      clearPrivateState();
      $('#signed-in-as').textContent = currentUser.email || '';
      $('#household-timezone').value ||= Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
      showOnly('household');
      return;
    }
    $('#active-household-name').textContent = household.name;
    const partnerCount = household.members.length;
    $('#member-summary').textContent = `${partnerCount} of 2 partners · Last refreshed ${lastRefresh.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    $('#invite-partner').hidden = partnerCount >= 2;
    showOnly('workspace');
    await refreshGroceries();
    await refreshBudget();
  } catch (cause) {
    serviceStatus.hidden = false;
    serviceStatus.dataset.state = 'unavailable';
    serviceStatus.textContent = 'Your household could not be refreshed. No changes were saved. Please try again.';
    console.error('Household refresh failed', cause);
  }
}

function addPurchaseRow({ name = '', quantity = '1', price = '' } = {}) {
  const row = element('div', 'purchase-line');
  const nameInput = element('input'); nameInput.placeholder = 'Item name'; nameInput.required = true; nameInput.maxLength = 100; nameInput.value = name; nameInput.setAttribute('aria-label', 'Item name');
  const quantityInput = element('input'); quantityInput.type = 'number'; quantityInput.min = '0.01'; quantityInput.max = '999'; quantityInput.step = '0.01'; quantityInput.required = true; quantityInput.value = quantity; quantityInput.setAttribute('aria-label', 'Quantity');
  const priceInput = element('input'); priceInput.inputMode = 'decimal'; priceInput.placeholder = 'Line price ($)'; priceInput.required = true; priceInput.value = price; priceInput.setAttribute('aria-label', 'Line price in dollars');
  const remove = element('button', 'quiet-button danger', 'Remove'); remove.type = 'button';
  remove.addEventListener('click', () => row.remove());
  row.append(nameInput, quantityInput, priceInput, remove);
  $('#purchase-lines').append(row);
  return row;
}

function editPurchase(purchase) {
  editingPurchase = purchase;
  pendingPurchase = null;
  $('#purchase-conflict').hidden = true;
  $('#purchase-merchant').value = purchase.merchant;
  $('#purchase-date').value = purchase.purchased_on;
  for (const [key, value] of [['discount',purchase.discount_cents],['delivery',purchase.delivery_cents],
    ['service',purchase.service_cents],['tax',purchase.tax_cents],['tip',purchase.tip_cents],['paid',purchase.paid_total_cents]]) {
    $(`#purchase-${key}`).value = value == null ? '' : (value / 100).toFixed(2);
  }
  $('#purchase-lines').replaceChildren();
  for (const line of groceryData.lines.filter(row => row.purchase_id === purchase.id)) {
    addPurchaseRow({ name: line.name_snapshot, quantity: String(line.quantity), price: (line.line_total_cents / 100).toFixed(2) });
  }
  $('#purchase-form button[type="submit"]').textContent = 'Review and save correction';
  setStatus($('#purchase-status'), 'Correcting an existing purchase. Its spending contribution will be replaced, not added again.');
  showView('purchase');
  $('#purchase-merchant').focus();
}

function resetPurchaseForm() {
  editingPurchase = null;
  pendingPurchase = null;
  $('#purchase-conflict').hidden = true;
  $('#purchase-form').reset();
  $('#purchase-date').value = householdToday(household?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  $('#purchase-lines').replaceChildren();
  addPurchaseRow();
  $('#purchase-form button[type="submit"]').textContent = 'Review and save purchase';
}

async function commitPurchase(options = {}) {
  const { payload, operationId } = pendingPurchase;
  const result = await savePurchase(client, payload, operationId, options);
  if (result?.status === 'duplicate_review') {
    pendingPurchase.candidateIds = result.candidate_ids;
    const candidates = $('#conflict-candidates'); candidates.replaceChildren();
    for (const id of result.candidate_ids) {
      const match = groceryData.purchases.find(purchase => purchase.id === id);
      if (!match) continue;
      const button = element('button', 'outline-button', `Replace ${match.merchant} · ${match.purchased_on} · ${dollars(match.paid_total_cents)}`);
      button.type = 'button';
      button.addEventListener('click', async () => {
        try { await commitPurchase({ replaceId: match.id, expectedRevision: match.revision }); }
        catch (error) { setStatus($('#purchase-status'), error.message || 'Could not reconcile purchase.', true); }
      });
      candidates.append(button);
    }
    $('#purchase-conflict').hidden = false;
    setStatus($('#purchase-status'), 'Review the possible duplicate before saving.');
    return;
  }
  if (result?.status !== 'saved') throw new Error('Purchase was not saved. Please try again.');
  resetPurchaseForm();
  setStatus($('#purchase-status'), 'Purchase confirmed. Both partners can now see it, and its paid total counts toward spending.');
  await refreshHousehold();
}

$('#add-purchase-line').addEventListener('click', () => addPurchaseRow());
$('#purchase-form').addEventListener('input', () => { pendingPurchase = null; $('#purchase-conflict').hidden = true; });
$('#purchase-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const rows = [...document.querySelectorAll('#purchase-lines .purchase-line')].map(row => {
      const [name, quantity, price] = row.querySelectorAll('input');
      return { name: name.value, quantity: quantity.value, price: price.value };
    });
    const value = key => $(`#purchase-${key}`).value;
    const payload = purchasePayload({ merchant: value('merchant'), date: value('date'),
      discount: value('discount'), delivery: value('delivery'), service: value('service'),
      tax: value('tax'), tip: value('tip'), paid: value('paid') }, rows);
    if (!pendingPurchase || JSON.stringify(pendingPurchase.payload) !== JSON.stringify(payload)) {
      pendingPurchase = { payload, operationId: crypto.randomUUID() };
    }
    await commitPurchase(editingPurchase ? { replaceId: editingPurchase.id, expectedRevision: editingPurchase.revision } : {});
  } catch (error) { setStatus($('#purchase-status'), error.message || 'Could not save purchase.', true); }
  finally { button.disabled = false; }
});
$('#save-distinct').addEventListener('click', async () => {
  if (!pendingPurchase?.candidateIds) return;
  try { await commitPurchase({ distinctCandidateIds: pendingPurchase.candidateIds }); }
  catch (error) { setStatus($('#purchase-status'), error.message || 'Could not save purchase.', true); }
});
$('#add-item-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true;
  try {
    await addItem(client, $('#new-item-name').value, $('#new-item-essential').checked);
    $('#add-item-form').reset();
    setStatus($('#item-status'), 'Added to your shared list.');
    await refreshHousehold();
  } catch (error) { setStatus($('#item-status'), error.message || 'Could not add item.', true); }
  finally { button.disabled = false; }
});
$('#budget-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true;
  try {
    const allowance = cents($('#monthly-allowance').value);
    await saveBudget(client, currentMonth(), allowance, budgetData?.revision);
    setStatus($('#budget-status'), 'Monthly budget updated for both partners.');
    await refreshBudget();
  } catch (error) { setStatus($('#budget-status'), error.message || 'Could not save budget.', true); }
  finally { button.disabled = false; }
});
$('#check-form').addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    const value = key => $(`#basket-${key}`).value;
    checkInputs = {
      groceriesCents: cents(value('groceries')),
      thresholdCents: cents(value('threshold'), { optional: true }),
      charges: ['delivery','service','tax','tip'].map(key => cents(value(key), { optional: true }))
    };
    checkSelected = new Set(); checkAlready = new Set();
    checkSuggestions = refillSuggestions(groceryData, householdToday(household.timezone), household.timezone);
    renderCheck();
    setStatus($('#check-status'), 'Check ready. You choose every addition; nothing has been ordered or counted as spending.');
  } catch (error) { setStatus($('#check-status'), error.message || 'Review the basket amounts.', true); }
});
$('#check-form').addEventListener('input', () => { $('#check-results').hidden = true; checkInputs = null; });
resetPurchaseForm();

async function handle(form, statusNode, action, successMessage) {
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  setStatus(statusNode, 'Working…');
  try {
    const result = await action();
    setStatus(statusNode, successMessage);
    return result;
  } catch (error) {
    setStatus(statusNode, error.message || 'Something went wrong. Please try again.', true);
    return null;
  } finally {
    button.disabled = false;
  }
}

$('#email-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!config?.emailCodesReady) return;
  const email = $('#account-email').value;
  const sent = await handle(event.currentTarget, $('#auth-status'), async () => {
    await sendEmailCode(client, email);
    return true;
  }, 'Check your email for a six-digit code.');
  if (sent) {
    $('#email-form').hidden = true;
    $('#code-form').hidden = false;
    $('#account-code').focus();
  }
});

$('#code-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const verified = await handle(event.currentTarget, $('#auth-status'),
    () => verifyEmailCode(client, $('#account-email').value, $('#account-code').value),
    'Signed in. Opening your household…');
  if (verified) await refreshHousehold();
});

$('#change-email').addEventListener('click', () => {
  $('#code-form').hidden = true;
  $('#email-form').hidden = false;
  $('#account-code').value = '';
  setStatus($('#auth-status'), '');
  $('#account-email').focus();
});

$('#create-household-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const created = await handle(event.currentTarget, $('#household-status'),
    () => createHousehold(client, $('#household-name').value, $('#household-timezone').value),
    'Household created. Opening your shared space…');
  if (created) await refreshHousehold();
});

$('#join-household-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const joined = await handle(event.currentTarget, $('#household-status'),
    () => acceptInvite(client, $('#invite-token').value),
    'You joined the household. Opening your shared space…');
  if (joined) await refreshHousehold();
});

$('#invite-partner').addEventListener('click', () => {
  invitePanel.hidden = !invitePanel.hidden;
  if (!invitePanel.hidden) $('#partner-email').focus();
});

$('#invite-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const token = await handle(event.currentTarget, $('#invite-status'),
    () => createInvite(client, $('#partner-email').value),
    'Private invitation created. Share the link only with your partner.');
  if (token) {
    $('#invite-link').value = inviteLink(window.location.origin, token);
    $('#invite-result').hidden = false;
  }
});

$('#copy-invite').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#invite-link').value);
    setStatus($('#invite-status'), 'Invite link copied.');
  } catch {
    $('#invite-link').select();
    setStatus($('#invite-status'), 'Select and copy the link to share it.');
  }
});

$('#revoke-invite').addEventListener('click', async () => {
  if (!window.confirm('Revoke the current partner invitation? The shared link will stop working.')) return;
  try {
    await revokeInvite(client);
    $('#invite-result').hidden = true;
    $('#invite-link').value = '';
    setStatus($('#invite-status'), 'The active invitation has been revoked.');
  } catch (error) {
    setStatus($('#invite-status'), error.message || 'Could not revoke the invitation.', true);
  }
});

$('#leave-household').addEventListener('click', async () => {
  if (!window.confirm('Leave this household? You will immediately lose access to its shared groceries.')) return;
  try {
    await leaveHousehold(client);
    clearPrivateState();
    await client.auth.signOut();
    currentUser = null;
    showOnly('access');
    setStatus($('#auth-status'), 'You left the household.');
  } catch (error) {
    setStatus($('#member-status'), error.message || 'Could not leave the household.', true);
  }
});

async function signOut() {
  await client.auth.signOut();
  currentUser = null;
  clearPrivateState();
  $('#code-form').hidden = true;
  $('#email-form').hidden = false;
  $('#account-code').value = '';
  showOnly('access');
}

$('#sign-out').addEventListener('click', signOut);
$('#member-sign-out').addEventListener('click', signOut);
$('#refresh-household').addEventListener('click', refreshHousehold);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && currentUser) refreshHousehold();
});
setInterval(() => {
  if (!document.hidden && currentUser) refreshHousehold();
}, 30_000);

if (!config) {
  serviceStatus.dataset.state = 'unavailable';
  serviceStatus.textContent = 'The private pilot is not available on this address yet. The public waitlist is still open.';
} else {
  try {
    client = createPilotClient(config, window.supabase);
    if (!config.emailCodesReady) {
      $('#email-setup-note').hidden = false;
      $('#account-email').disabled = true;
      $('#email-form button[type="submit"]').disabled = true;
    }
    serviceStatus.dataset.state = 'ready';
    serviceStatus.textContent = 'Connecting to your private pilot…';
    refreshHousehold();
  } catch (error) {
    serviceStatus.dataset.state = 'unavailable';
    serviceStatus.textContent = error.message;
  }
}

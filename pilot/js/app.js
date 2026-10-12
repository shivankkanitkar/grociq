import { resolvePilotConfig } from './config.js';

const serviceStatus = document.querySelector('#service-status');
const config = resolvePilotConfig(window.location.hostname);

if (config) {
  serviceStatus.dataset.state = 'ready';
  serviceStatus.textContent = 'Pilot configuration found. Household sign-in will appear here when access is enabled.';
} else {
  serviceStatus.dataset.state = 'unavailable';
  serviceStatus.textContent = 'The private pilot is not available on this address yet. The public waitlist is still open.';
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

document.querySelector('.workspace').addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-view], [data-open]');
  if (!trigger) return;
  showView(trigger.dataset.view || trigger.dataset.open);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePilotConfig } from '../../pilot/js/config.js';

const approvedHosts = {
  'grociq.vercel.app': { url: 'https://pilot-prod.supabase.co', key: 'prod-publishable' },
  'pilot-preview.example.test': { url: 'https://pilot-test.supabase.co', key: 'test-publishable' }
};

test('exact approved production hostname selects production only', () => {
  assert.deepEqual(resolvePilotConfig('grociq.vercel.app', approvedHosts), approvedHosts['grociq.vercel.app']);
});

test('exact preview hostname selects test only', () => {
  assert.deepEqual(resolvePilotConfig('pilot-preview.example.test', approvedHosts), approvedHosts['pilot-preview.example.test']);
});

test('unknown and deceptive hostnames fail closed', () => {
  assert.equal(resolvePilotConfig('random-preview.vercel.app', approvedHosts), null);
  assert.equal(resolvePilotConfig('grociq.vercel.app.evil.test', approvedHosts), null);
});

test('incomplete project configuration fails closed', () => {
  assert.equal(resolvePilotConfig('grociq.vercel.app', { 'grociq.vercel.app': { url: '', key: '' } }), null);
});

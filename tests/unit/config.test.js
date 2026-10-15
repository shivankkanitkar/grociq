import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePilotConfig, pilotProjects } from '../../pilot/js/config.js';

const approvedHosts = {
  'grociq.vercel.app': { url: 'https://pilot-prod.supabase.co', key: 'prod-publishable' },
  'pilot-preview.example.test': { url: 'https://pilot-test.supabase.co', key: 'test-publishable' }
};

test('exact approved production hostname selects production only', () => {
  assert.deepEqual(resolvePilotConfig('grociq.vercel.app', approvedHosts), { ...approvedHosts['grociq.vercel.app'], googleReady: false });
});

test('exact preview hostname selects test only', () => {
  assert.deepEqual(resolvePilotConfig('pilot-preview.example.test', approvedHosts), { ...approvedHosts['pilot-preview.example.test'], googleReady: false });
});

test('unknown and deceptive hostnames fail closed', () => {
  assert.equal(resolvePilotConfig('random-preview.vercel.app', approvedHosts), null);
  assert.equal(resolvePilotConfig('grociq.vercel.app.evil.test', approvedHosts), null);
});

test('incomplete project configuration fails closed', () => {
  assert.equal(resolvePilotConfig('grociq.vercel.app', { 'grociq.vercel.app': { url: '', key: '' } }), null);
});

test('live configuration includes the exact test-branch alias but never production or an unknown preview', () => {
  assert.equal(resolvePilotConfig('127.0.0.1')?.url, 'https://njaoyeiuericdxaqpghm.supabase.co');
  assert.equal(resolvePilotConfig('localhost')?.url, 'https://njaoyeiuericdxaqpghm.supabase.co');
  assert.equal(resolvePilotConfig('localhost')?.googleReady, false);
  assert.equal(resolvePilotConfig('grociq-git-feat-grociq-app-shivankkanitkar2027-9139.vercel.app')?.url, 'https://njaoyeiuericdxaqpghm.supabase.co');
  assert.equal(resolvePilotConfig('grociq-git-feat-us-couples-pilot-shivankkanitkar2027-9139.vercel.app')?.url, 'https://njaoyeiuericdxaqpghm.supabase.co');
  assert.equal(resolvePilotConfig('grociq-git-feat-us-couples-pilot-shivankkanitkar2027-9139.vercel.app')?.googleReady, false);
  assert.equal(resolvePilotConfig('grociq.vercel.app'), null);
  assert.equal(resolvePilotConfig('grociq-2z61tu8cd-shivankkanitkar2027-9139.vercel.app'), null);
  assert.equal(Object.keys(pilotProjects).length, 4);
});

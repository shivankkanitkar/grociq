import test from 'node:test';
import assert from 'node:assert/strict';
import { createPilotClient, sendEmailCode, verifyEmailCode, loadMembership, inviteLink } from '../../pilot/js/auth.js';

test('sign-in uses the isolated project and normalizes the email', async () => {
  const calls = [];
  const client = createPilotClient({ url: 'https://pilot.supabase.co', key: 'publishable' }, {
    createClient(url, key, options) {
      calls.push([url, key, options.auth.persistSession]);
      return { auth: { async signInWithOtp(args) { calls.push(args); return { error: null }; } } };
    }
  });
  await sendEmailCode(client, ' Person@Example.com ');
  assert.deepEqual(calls, [
    ['https://pilot.supabase.co', 'publishable', true],
    { email: 'person@example.com' }
  ]);
});

test('verification requires a code and propagates provider errors', async () => {
  const client = { auth: { async verifyOtp(args) {
    assert.deepEqual(args, { email: 'person@example.com', token: '123456', type: 'email' });
    return { data: { user: { id: 'u1' } }, error: null };
  } } };
  assert.deepEqual(await verifyEmailCode(client, ' PERSON@example.com ', ' 123456 '), { id: 'u1' });
  await assert.rejects(() => sendEmailCode({ auth: { async signInWithOtp() { return { error: new Error('rate limited') }; } } }, 'x@y.com'), /rate limited/);
});

test('membership fetch does not invent a household when the server returns none', async () => {
  const client = { async rpc() { return { data: null, error: null }; } };
  assert.equal(await loadMembership(client), null);
});

test('invite link encodes the token without an automatic send', () => {
  assert.equal(inviteLink('https://preview.example.test', 'a b'), 'https://preview.example.test/pilot/?invite=a%20b');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPilotClient, signInWithGoogle, sendEmailCode, verifyEmailCode, loadMembership, createHousehold, inviteLink } from '../../pilot/js/auth.js';

test('Google sign-in returns to the grocery app', async () => {
  const client = { auth: { async signInWithOAuth(options) {
    assert.deepEqual(options, { provider: 'google', options: { redirectTo: 'https://grociq.vercel.app/app/' } });
    return { error: null };
  } } };
  await signInWithGoogle(client, 'https://grociq.vercel.app/app/');
});

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

test('one-person household creation records the chosen US shopping rhythm', async () => {
  const client = { async rpc(name, args) {
    assert.equal(name, 'create_household');
    assert.deepEqual(args, { p_name: 'My kitchen', p_timezone: 'America/New_York', p_shopping_cycle_days: 14 });
    return { data: 'household-1', error: null };
  } };
  assert.equal(await createHousehold(client, 'My kitchen', 'America/New_York', '14'), 'household-1');
});

test('invite link encodes the token without an automatic send', () => {
  assert.equal(inviteLink('https://preview.example.test', 'a b'), 'https://preview.example.test/app/?invite=a%20b');
});

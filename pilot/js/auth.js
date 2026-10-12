export function createPilotClient(config, sdk) {
  if (!config || !sdk?.createClient) throw new Error('Pilot sign-in is unavailable. Please try again later.');
  return sdk.createClient(config.url, config.key, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
  });
}

export async function sendEmailCode(client, email) {
  const { error } = await client.auth.signInWithOtp({ email: email.trim().toLowerCase() });
  if (error) throw error;
}

export async function verifyEmailCode(client, email, code) {
  const { data, error } = await client.auth.verifyOtp({
    email: email.trim().toLowerCase(), token: code.trim(), type: 'email'
  });
  if (error) throw error;
  return data.user;
}

export async function loadMembership(client) {
  const { data: householdId, error: idError } = await client.rpc('my_household_id');
  if (idError) throw idError;
  if (!householdId) return null;
  const [householdResult, memberResult] = await Promise.all([
    client.from('households').select('id,name,timezone,created_at,revision').eq('id', householdId).single(),
    client.from('household_members').select('user_id,email,joined_at').eq('household_id', householdId)
  ]);
  if (householdResult.error) throw householdResult.error;
  if (memberResult.error) throw memberResult.error;
  return { ...householdResult.data, members: memberResult.data };
}

export async function createHousehold(client, name, timezone) {
  const { data, error } = await client.rpc('create_pilot_household', { p_name: name, p_timezone: timezone });
  if (error) throw error;
  return data;
}

export async function acceptInvite(client, token) {
  const { data, error } = await client.rpc('accept_partner_invite', { p_token: token.trim() });
  if (error) throw error;
  return data;
}

export async function createInvite(client, email) {
  const { data, error } = await client.rpc('create_partner_invite', { p_email: email.trim().toLowerCase() });
  if (error) throw error;
  return data;
}

export async function revokeInvite(client) {
  const { error } = await client.rpc('revoke_partner_invite');
  if (error) throw error;
}

export async function leaveHousehold(client) {
  const { error } = await client.rpc('leave_pilot_household');
  if (error) throw error;
}

export function inviteLink(origin, token) {
  return `${origin}/pilot/?invite=${encodeURIComponent(token)}`;
}

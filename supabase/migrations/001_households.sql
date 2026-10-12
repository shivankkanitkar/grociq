-- GrocIQ couples pilot: isolated from the public waitlist project.
-- Run only against the approved pilot test project, then a separately approved pilot production project.
create schema if not exists private;
create extension if not exists pgcrypto with schema extensions;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  timezone text not null,
  created_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0)
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (user_id)
);

create table private.pilot_enrolments (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

create table private.household_invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  recipient_email text not null,
  token_hash bytea not null unique,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz
);
create index household_invitations_active_idx on private.household_invitations(household_id, expires_at) where used_at is null and revoked_at is null;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table private.pilot_enrolments enable row level security;
alter table private.household_invitations enable row level security;

revoke all on public.households, public.household_members from anon, authenticated;
revoke all on private.pilot_enrolments, private.household_invitations from public, anon, authenticated;
grant select on public.households, public.household_members to authenticated;

create or replace function public.my_household_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select household_id from public.household_members where user_id = auth.uid() limit 1;
$$;

create or replace function public.is_household_member(p_household_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.household_members where household_id = p_household_id and user_id = auth.uid());
$$;

revoke all on function public.my_household_id(), public.is_household_member(uuid) from public, anon;
grant execute on function public.my_household_id(), public.is_household_member(uuid) to authenticated;

create policy household_read on public.households for select to authenticated
using (id = (select public.my_household_id()));
create policy members_read on public.household_members for select to authenticated
using (household_id = (select public.my_household_id()));

create or replace function public.create_pilot_household(p_name text, p_timezone text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_household uuid;
begin
  if v_user is null then raise exception 'Sign in first'; end if;
  select lower(email) into v_email from auth.users where id = v_user and email_confirmed_at is not null;
  if v_email is null then raise exception 'Verify your email first'; end if;
  if not exists(select 1 from private.pilot_enrolments where email = v_email) then
    raise exception 'This account is not enrolled in the pilot';
  end if;
  if exists(select 1 from public.household_members where user_id = v_user) then
    raise exception 'You already belong to a household';
  end if;
  if p_name is null or length(trim(p_name)) not between 1 and 80 then
    raise exception 'Enter a household name';
  end if;
  if p_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Choose a valid timezone';
  end if;
  insert into public.households(name, timezone) values(trim(p_name), p_timezone) returning id into v_household;
  insert into public.household_members(household_id, user_id, email) values(v_household, v_user, v_email);
  return v_household;
end;
$$;

create or replace function public.create_partner_invite(p_email text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_household uuid;
  v_email text := lower(trim(p_email));
  v_token text;
begin
  select household_id into v_household from public.household_members where user_id = v_user;
  if v_household is null then raise exception 'Household access required'; end if;
  perform 1 from public.households where id = v_household for update;
  if (select count(*) from public.household_members where household_id = v_household) >= 2 then
    raise exception 'This household already has two partners';
  end if;
  if v_email is null or v_email !~ '^[^ @]+@[^ @]+\.[^ @]+$' then raise exception 'Enter a valid partner email'; end if;
  if exists(select 1 from public.household_members where household_id = v_household and email = v_email) then
    raise exception 'This partner already belongs to the household';
  end if;
  update private.household_invitations set revoked_at = now()
  where household_id = v_household and used_at is null and revoked_at is null;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into private.household_invitations(household_id, recipient_email, token_hash, created_by, expires_at)
  values(v_household, v_email, extensions.digest(v_token, 'sha256'), v_user, now() + interval '48 hours');
  return v_token;
end;
$$;

create or replace function public.accept_partner_invite(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_invite private.household_invitations%rowtype;
begin
  if v_user is null then raise exception 'Sign in first'; end if;
  select lower(email) into v_email from auth.users where id = v_user and email_confirmed_at is not null;
  if v_email is null then raise exception 'Verify your email first'; end if;
  if exists(select 1 from public.household_members where user_id = v_user) then
    raise exception 'You already belong to a household';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then raise exception 'Invitation is invalid'; end if;
  select * into v_invite from private.household_invitations
  where token_hash = extensions.digest(p_token, 'sha256');
  if not found or v_invite.used_at is not null or v_invite.revoked_at is not null
    or v_invite.expires_at <= now() or v_invite.recipient_email <> v_email then
    raise exception 'Invitation is invalid or expired';
  end if;
  perform 1 from public.households where id = v_invite.household_id for update;
  select * into v_invite from private.household_invitations
  where token_hash = extensions.digest(p_token, 'sha256') for update;
  if not found or v_invite.used_at is not null or v_invite.revoked_at is not null
    or v_invite.expires_at <= now() or v_invite.recipient_email <> v_email then
    raise exception 'Invitation is invalid or expired';
  end if;
  if (select count(*) from public.household_members where household_id = v_invite.household_id) >= 2 then
    raise exception 'This household already has two partners';
  end if;
  insert into public.household_members(household_id, user_id, email)
  values(v_invite.household_id, v_user, v_email);
  update private.household_invitations set used_at = now() where id = v_invite.id;
  return v_invite.household_id;
end;
$$;

create or replace function public.revoke_partner_invite()
returns void language plpgsql security definer set search_path = '' as $$
declare v_household uuid := public.my_household_id();
begin
  if v_household is null then raise exception 'Household access required'; end if;
  update private.household_invitations set revoked_at = now()
  where household_id = v_household and used_at is null and revoked_at is null;
end;
$$;

revoke all on function public.create_pilot_household(text,text), public.create_partner_invite(text),
  public.accept_partner_invite(text), public.revoke_partner_invite() from public, anon;
grant execute on function public.create_pilot_household(text,text), public.create_partner_invite(text),
  public.accept_partner_invite(text), public.revoke_partner_invite() to authenticated;

-- Keep invitation and membership changes serialized on the household row.
create or replace function public.revoke_partner_invite()
returns void language plpgsql security definer set search_path = '' as $$
declare v_household uuid := public.my_household_id();
begin
  if v_household is null then raise exception 'Household access required'; end if;
  perform 1 from public.households where id = v_household for update;
  if not exists (select 1 from public.household_members
    where household_id = v_household and user_id = auth.uid()) then
    raise exception 'Household access required';
  end if;
  update private.household_invitations set revoked_at = now()
  where household_id = v_household and used_at is null and revoked_at is null;
end;
$$;

-- Leaving immediately removes the caller's access. Shared history remains for a
-- partner; an empty household is retained for verified founder-assisted deletion.
create or replace function public.leave_pilot_household()
returns void language plpgsql security definer set search_path = '' as $$
declare v_household uuid := public.my_household_id();
begin
  if v_household is null then raise exception 'Household access required'; end if;
  perform 1 from public.households where id = v_household for update;
  if not exists (select 1 from public.household_members
    where household_id = v_household and user_id = auth.uid()) then
    raise exception 'Household access required';
  end if;
  update private.household_invitations set revoked_at = now()
  where household_id = v_household and used_at is null and revoked_at is null;
  delete from public.household_members
  where household_id = v_household and user_id = auth.uid();
end;
$$;

revoke all on function public.leave_pilot_household() from public, anon;
grant execute on function public.leave_pilot_household() to authenticated;

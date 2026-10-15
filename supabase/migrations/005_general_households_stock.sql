-- General GrocIQ households: one person can use the app alone, or invite one partner.
-- Apply after 001-004 to the separately approved app database.
alter table public.households
  add column shopping_cycle_days integer not null default 7
  check (shopping_cycle_days in (7, 14, 30));

alter table public.grocery_items
  add column quantity_on_hand numeric(10,2)
    check (quantity_on_hand is null or quantity_on_hand >= 0),
  add column quantity_unit text
    check (quantity_unit is null or length(trim(quantity_unit)) between 1 and 20),
  add column refill_at numeric(10,2)
    check (refill_at is null or refill_at >= 0),
  add column quantity_confirmed_at timestamptz,
  add column quantity_confirmed_by uuid references auth.users(id);

create or replace function public.create_household(
  p_name text, p_timezone text, p_shopping_cycle_days integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_household uuid;
begin
  if v_user is null then raise exception 'Sign in first'; end if;
  select lower(email) into v_email from auth.users
  where id = v_user and email_confirmed_at is not null;
  if v_email is null then raise exception 'Use an account with a verified email address'; end if;
  if exists(select 1 from public.household_members where user_id = v_user) then
    raise exception 'You already belong to a household';
  end if;
  if p_name is null or length(trim(p_name)) not between 1 and 80 then
    raise exception 'Enter a household name';
  end if;
  if p_timezone is null or not exists(
    select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Choose a valid timezone';
  end if;
  if p_shopping_cycle_days not in (7,14,30) or p_shopping_cycle_days is null then
    raise exception 'Choose weekly, every two weeks, or monthly shopping';
  end if;
  insert into public.households(name, timezone, shopping_cycle_days)
  values(trim(p_name), p_timezone, p_shopping_cycle_days)
  returning id into v_household;
  insert into public.household_members(household_id, user_id, email)
  values(v_household, v_user, v_email);
  return v_household;
end;
$$;

create or replace function public.set_grocery_details(
  p_item_id uuid, p_expected_revision integer, p_availability text,
  p_requested boolean, p_essential boolean, p_quantity_on_hand numeric,
  p_quantity_unit text, p_refill_at numeric)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := public.my_household_id();
  v_revision integer;
  v_unit text := nullif(trim(p_quantity_unit), '');
begin
  if v_household is null then raise exception 'Household access required'; end if;
  if p_availability not in ('unknown','available','low','finished')
    or p_availability is null or p_requested is null or p_essential is null then
    raise exception 'Choose a valid item state';
  end if;
  if p_quantity_on_hand < 0 or p_refill_at < 0
    or (v_unit is not null and length(v_unit) > 20)
    or (p_quantity_on_hand is not null and v_unit is null)
    or (p_refill_at is not null and v_unit is null) then
    raise exception 'Review the stock quantity, unit and refill point';
  end if;
  if p_quantity_on_hand = 0 and p_availability = 'available' then
    raise exception 'An item with zero stock cannot be marked available';
  end if;
  update public.grocery_items set
    availability = p_availability, requested = p_requested,
    essential = p_essential, quantity_on_hand = p_quantity_on_hand,
    quantity_unit = v_unit, refill_at = p_refill_at,
    quantity_confirmed_at = case
      when p_quantity_on_hand is null then null
      when quantity_on_hand is distinct from p_quantity_on_hand or quantity_unit is distinct from v_unit then now()
      else quantity_confirmed_at end,
    quantity_confirmed_by = case
      when p_quantity_on_hand is null then null
      when quantity_on_hand is distinct from p_quantity_on_hand or quantity_unit is distinct from v_unit then auth.uid()
      else quantity_confirmed_by end,
    availability_at = case when availability is distinct from p_availability then now() else availability_at end,
    availability_by = case when availability is distinct from p_availability then auth.uid() else availability_by end,
    revision = revision + 1, updated_at = now(), updated_by = auth.uid()
  where id = p_item_id and household_id = v_household
    and revision = p_expected_revision
  returning revision into v_revision;
  if v_revision is null then
    raise exception 'This item changed. Refresh and review the latest version.';
  end if;
  return v_revision;
end;
$$;

revoke all on function public.create_household(text,text,integer),
  public.set_grocery_details(uuid,integer,text,boolean,boolean,numeric,text,numeric)
  from public, anon;
grant execute on function public.create_household(text,text,integer),
  public.set_grocery_details(uuid,integer,text,boolean,boolean,numeric,text,numeric)
  to authenticated;

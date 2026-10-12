-- Shared groceries and confirmed manual purchases. All client writes use narrow RPCs.
create table public.grocery_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  essential boolean not null default false,
  requested boolean not null default false,
  availability text not null default 'unknown' check (availability in ('unknown','available','low','finished')),
  availability_at timestamptz,
  availability_by uuid references auth.users(id),
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  unique (id, household_id)
);
create unique index grocery_items_household_name_idx on public.grocery_items(household_id, lower(trim(name)));

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  merchant text not null check (length(trim(merchant)) between 1 and 100),
  purchased_on date not null,
  groceries_subtotal_cents integer not null check (groceries_subtotal_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  delivery_cents integer check (delivery_cents >= 0),
  service_cents integer check (service_cents >= 0),
  tax_cents integer check (tax_cents >= 0),
  tip_cents integer check (tip_cents >= 0),
  paid_total_cents integer not null check (paid_total_cents >= 0),
  source text not null default 'manual' check (source in ('manual','receipt')),
  revision integer not null default 1 check (revision > 0),
  confirmed_at timestamptz not null default now(),
  confirmed_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  voided_at timestamptz,
  voided_by uuid references auth.users(id),
  unique (id, household_id)
);
create index purchases_household_date_idx on public.purchases(household_id, purchased_on desc) where voided_at is null;

create table public.purchase_lines (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  purchase_id uuid not null,
  item_id uuid not null,
  name_snapshot text not null,
  quantity numeric(8,2) not null check (quantity > 0),
  line_total_cents integer not null check (line_total_cents >= 0),
  foreign key (purchase_id, household_id) references public.purchases(id, household_id) on delete cascade,
  foreign key (item_id, household_id) references public.grocery_items(id, household_id)
);
create index purchase_lines_item_idx on public.purchase_lines(item_id);

create table private.purchase_operations (
  household_id uuid not null references public.households(id) on delete cascade,
  operation_id uuid not null,
  payload_hash bytea not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (household_id, operation_id)
);

alter table public.grocery_items enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_lines enable row level security;
alter table private.purchase_operations enable row level security;
revoke all on public.grocery_items, public.purchases, public.purchase_lines from anon, authenticated;
revoke all on private.purchase_operations from public, anon, authenticated;
grant select on public.grocery_items, public.purchases, public.purchase_lines to authenticated;
create policy grocery_read on public.grocery_items for select to authenticated
  using (household_id = (select public.my_household_id()));
create policy purchase_read on public.purchases for select to authenticated
  using (household_id = (select public.my_household_id()));
create policy purchase_line_read on public.purchase_lines for select to authenticated
  using (household_id = (select public.my_household_id()));

create or replace function public.add_grocery_item(p_name text, p_essential boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_household uuid := public.my_household_id(); v_item uuid;
begin
  if v_household is null then raise exception 'Household access required'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 100 then raise exception 'Enter an item name'; end if;
  insert into public.grocery_items(household_id, name, essential, requested, updated_by)
  values(v_household, trim(p_name), coalesce(p_essential,false), true, auth.uid())
  on conflict (household_id, lower(trim(name))) do update
    set requested = true, essential = public.grocery_items.essential or excluded.essential,
        revision = public.grocery_items.revision + 1, updated_at = now(), updated_by = auth.uid()
  returning id into v_item;
  return v_item;
end;
$$;

create or replace function public.set_grocery_state(
  p_item_id uuid, p_expected_revision integer, p_availability text,
  p_requested boolean, p_essential boolean)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_household uuid := public.my_household_id(); v_revision integer;
begin
  if v_household is null then raise exception 'Household access required'; end if;
  if p_availability not in ('unknown','available','low','finished')
    or p_requested is null or p_essential is null then raise exception 'Choose a valid item state'; end if;
  update public.grocery_items set
    availability = p_availability,
    availability_at = case when availability is distinct from p_availability then now() else availability_at end,
    availability_by = case when availability is distinct from p_availability then auth.uid() else availability_by end,
    requested = p_requested, essential = p_essential,
    updated_at = now(), updated_by = auth.uid(), revision = revision + 1
  where id = p_item_id and household_id = v_household and revision = p_expected_revision
  returning revision into v_revision;
  if v_revision is null then raise exception 'This item changed. Refresh and review the latest version.'; end if;
  return v_revision;
end;
$$;

create or replace function public.confirm_purchase(
  p_payload jsonb, p_operation_id uuid,
  p_replace_purchase_id uuid default null, p_expected_revision integer default null,
  p_distinct_candidate_ids uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := public.my_household_id();
  v_hash bytea; v_old private.purchase_operations%rowtype;
  v_merchant text; v_date date; v_paid integer; v_subtotal integer;
  v_discount integer; v_delivery integer; v_service integer; v_tax integer; v_tip integer;
  v_line jsonb; v_lines jsonb; v_name text; v_price integer; v_quantity numeric;
  v_sum bigint := 0; v_known_fees bigint := 0; v_candidate_ids uuid[]; v_ack uuid[];
  v_purchase uuid; v_revision integer; v_item uuid; v_result jsonb;
begin
  if v_household is null then raise exception 'Household access required'; end if;
  if p_operation_id is null then raise exception 'A save operation ID is required'; end if;
  perform 1 from public.households where id = v_household for update;
  if not exists(select 1 from public.household_members where household_id = v_household and user_id = auth.uid()) then
    raise exception 'Household access required';
  end if;
  v_hash := extensions.digest(convert_to(jsonb_build_object('payload',p_payload,'replace',p_replace_purchase_id,
    'revision',p_expected_revision,'distinct',p_distinct_candidate_ids)::text,'UTF8'),'sha256');
  select * into v_old from private.purchase_operations
  where household_id = v_household and operation_id = p_operation_id;
  if found then
    if v_old.payload_hash <> v_hash then raise exception 'This save ID was already used for different details'; end if;
    return v_old.result;
  end if;
  if jsonb_typeof(p_payload) <> 'object' then raise exception 'Purchase details are required'; end if;
  v_merchant := trim(p_payload->>'merchant');
  if v_merchant is null or length(v_merchant) not between 1 and 100 then raise exception 'Enter a merchant'; end if;
  v_date := (p_payload->>'purchased_on')::date;
  if v_date is null or v_date > current_date + 1 then raise exception 'Choose a valid purchase date'; end if;
  v_paid := (p_payload->>'paid_total_cents')::integer;
  v_subtotal := (p_payload->>'groceries_subtotal_cents')::integer;
  v_discount := coalesce((p_payload->>'discount_cents')::integer,0);
  v_delivery := (p_payload->>'delivery_cents')::integer;
  v_service := (p_payload->>'service_cents')::integer;
  v_tax := (p_payload->>'tax_cents')::integer;
  v_tip := (p_payload->>'tip_cents')::integer;
  if v_paid is null or v_paid < 0 or v_subtotal is null or v_subtotal < 0 or v_discount < 0
    or coalesce(v_delivery,0) < 0 or coalesce(v_service,0) < 0
    or coalesce(v_tax,0) < 0 or coalesce(v_tip,0) < 0 then
    raise exception 'Enter valid non-negative dollar amounts';
  end if;
  v_lines := p_payload->'lines';
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) not between 1 and 100 then
    raise exception 'Add at least one purchased item';
  end if;
  for v_line in select value from jsonb_array_elements(v_lines) loop
    v_name := trim(v_line->>'name');
    v_price := (v_line->>'line_total_cents')::integer;
    v_quantity := coalesce((v_line->>'quantity')::numeric,1);
    if v_name is null or length(v_name) not between 1 and 100 or v_price is null
      or v_price < 0 or v_quantity <= 0 or v_quantity > 999 then
      raise exception 'Review each item name, quantity and price';
    end if;
    v_sum := v_sum + v_price;
  end loop;
  if v_sum - v_discount <> v_subtotal then
    raise exception 'Item prices minus the entered discount must equal the groceries subtotal';
  end if;
  v_known_fees := coalesce(v_delivery,0) + coalesce(v_service,0) + coalesce(v_tax,0) + coalesce(v_tip,0);
  if v_subtotal + v_known_fees > v_paid then
    raise exception 'The paid total is below the groceries and known charges';
  end if;
  if v_delivery is not null and v_service is not null and v_tax is not null and v_tip is not null
    and v_subtotal + v_known_fees <> v_paid then
    raise exception 'The complete breakdown does not match the paid total';
  end if;

  if p_replace_purchase_id is null then
    select coalesce(array_agg(p.id order by p.id), '{}') into v_candidate_ids
    from public.purchases p where p.household_id = v_household and p.voided_at is null
      and p.purchased_on = v_date and lower(trim(p.merchant)) = lower(v_merchant)
      and p.paid_total_cents = v_paid and exists (
        select 1 from public.purchase_lines pl
        join jsonb_array_elements(v_lines) proposed on lower(trim(proposed->>'name')) = lower(trim(pl.name_snapshot))
        where pl.purchase_id = p.id);
    select coalesce(array_agg(x order by x), '{}') into v_ack from unnest(coalesce(p_distinct_candidate_ids,'{}')) x;
    if cardinality(v_candidate_ids) > 0 and v_candidate_ids <> v_ack then
      return jsonb_build_object('status','duplicate_review','candidate_ids',v_candidate_ids);
    end if;
    insert into public.purchases(household_id,merchant,purchased_on,groceries_subtotal_cents,
      discount_cents,delivery_cents,service_cents,tax_cents,tip_cents,paid_total_cents,
      confirmed_by,updated_by)
    values(v_household,v_merchant,v_date,v_subtotal,v_discount,v_delivery,v_service,v_tax,v_tip,v_paid,
      auth.uid(),auth.uid()) returning id,revision into v_purchase,v_revision;
  else
    update public.purchases set merchant=v_merchant,purchased_on=v_date,
      groceries_subtotal_cents=v_subtotal,discount_cents=v_discount,delivery_cents=v_delivery,
      service_cents=v_service,tax_cents=v_tax,tip_cents=v_tip,paid_total_cents=v_paid,
      updated_at=now(),updated_by=auth.uid(),revision=revision+1
    where id=p_replace_purchase_id and household_id=v_household and voided_at is null
      and revision=p_expected_revision
    returning id,revision into v_purchase,v_revision;
    if v_purchase is null then raise exception 'This purchase changed. Refresh and review it first.'; end if;
    delete from public.purchase_lines where purchase_id=v_purchase and household_id=v_household;
  end if;

  for v_line in select value from jsonb_array_elements(v_lines) loop
    v_name := trim(v_line->>'name');
    insert into public.grocery_items(household_id,name,updated_by)
    values(v_household,v_name,auth.uid())
    on conflict (household_id, lower(trim(name))) do update
      set updated_at=now(),updated_by=auth.uid(),revision=public.grocery_items.revision+1
    returning id into v_item;
    insert into public.purchase_lines(household_id,purchase_id,item_id,name_snapshot,quantity,line_total_cents)
    values(v_household,v_purchase,v_item,v_name,coalesce((v_line->>'quantity')::numeric,1),
      (v_line->>'line_total_cents')::integer);
    update public.grocery_items set requested=false,revision=revision+1,updated_at=now(),updated_by=auth.uid()
    where id=v_item and requested;
  end loop;
  v_result := jsonb_build_object('status','saved','purchase_id',v_purchase,'revision',v_revision);
  insert into private.purchase_operations(household_id,operation_id,payload_hash,result)
  values(v_household,p_operation_id,v_hash,v_result);
  return v_result;
end;
$$;

create or replace function public.void_purchase(p_purchase_id uuid, p_expected_revision integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_household uuid := public.my_household_id(); v_revision integer;
begin
  if v_household is null then raise exception 'Household access required'; end if;
  perform 1 from public.households where id=v_household for update;
  update public.purchases set voided_at=now(),voided_by=auth.uid(),updated_at=now(),
    updated_by=auth.uid(),revision=revision+1
  where id=p_purchase_id and household_id=v_household and revision=p_expected_revision and voided_at is null
  returning revision into v_revision;
  if v_revision is null then raise exception 'This purchase changed. Refresh and review it first.'; end if;
  return v_revision;
end;
$$;

revoke all on function public.add_grocery_item(text,boolean), public.set_grocery_state(uuid,integer,text,boolean,boolean),
  public.confirm_purchase(jsonb,uuid,uuid,integer,uuid[]), public.void_purchase(uuid,integer) from public, anon;
grant execute on function public.add_grocery_item(text,boolean), public.set_grocery_state(uuid,integer,text,boolean,boolean),
  public.confirm_purchase(jsonb,uuid,uuid,integer,uuid[]), public.void_purchase(uuid,integer) to authenticated;

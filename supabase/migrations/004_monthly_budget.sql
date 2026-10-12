-- One allowance per household calendar month. Actual spend is derived from purchases.
create table public.monthly_budgets (
  household_id uuid not null references public.households(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  allowance_cents integer not null check (allowance_cents >= 0),
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  primary key (household_id, month)
);
alter table public.monthly_budgets enable row level security;
revoke all on public.monthly_budgets from anon, authenticated;
grant select on public.monthly_budgets to authenticated;
create policy budget_read on public.monthly_budgets for select to authenticated
  using (household_id = (select public.my_household_id()));

create or replace function public.set_monthly_budget(
  p_month date, p_allowance_cents integer, p_expected_revision integer default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_household uuid := public.my_household_id(); v_revision integer;
begin
  if v_household is null then raise exception 'Household access required'; end if;
  if p_month is null or extract(day from p_month) <> 1 or p_allowance_cents is null
    or p_allowance_cents < 0 then raise exception 'Choose a month and a valid budget'; end if;
  perform 1 from public.households where id = v_household for update;
  if not exists(select 1 from public.household_members where household_id=v_household and user_id=auth.uid()) then
    raise exception 'Household access required';
  end if;
  if p_expected_revision is null then
    insert into public.monthly_budgets(household_id,month,allowance_cents,updated_by)
    values(v_household,p_month,p_allowance_cents,auth.uid())
    on conflict do nothing returning revision into v_revision;
  else
    update public.monthly_budgets set allowance_cents=p_allowance_cents,revision=revision+1,
      updated_at=now(),updated_by=auth.uid()
    where household_id=v_household and month=p_month and revision=p_expected_revision
    returning revision into v_revision;
  end if;
  if v_revision is null then raise exception 'The budget changed. Refresh and review the latest amount.'; end if;
  return v_revision;
end;
$$;

create or replace function public.get_monthly_budget(p_month date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_household uuid := public.my_household_id(); v_allowance integer; v_revision integer;
  v_updated_at timestamptz; v_updated_by uuid; v_spent bigint; v_count integer;
begin
  if v_household is null then raise exception 'Household access required'; end if;
  if p_month is null or extract(day from p_month) <> 1 then raise exception 'Choose a month'; end if;
  select allowance_cents,revision,updated_at,updated_by
  into v_allowance,v_revision,v_updated_at,v_updated_by
  from public.monthly_budgets where household_id=v_household and month=p_month;
  select coalesce(sum(paid_total_cents),0),count(*) into v_spent,v_count
  from public.purchases where household_id=v_household and voided_at is null
    and purchased_on >= p_month and purchased_on < (p_month + interval '1 month')::date;
  return jsonb_build_object('month',p_month,'allowance_cents',v_allowance,'revision',v_revision,
    'updated_at',v_updated_at,'updated_by',v_updated_by,'spent_cents',v_spent,'purchase_count',v_count);
end;
$$;

revoke all on function public.set_monthly_budget(date,integer,integer),
  public.get_monthly_budget(date) from public, anon;
grant execute on function public.set_monthly_budget(date,integer,integer),
  public.get_monthly_budget(date) to authenticated;

-- Run only in the isolated pilot test project. Every synthetic row is rolled back.
begin;
insert into auth.users(id,email,email_confirmed_at)
values ('00000000-0000-4000-8000-000000000101','pilot-owner@example.test',now()),
       ('00000000-0000-4000-8000-000000000102','unrelated@example.test',now());
insert into private.pilot_enrolments(email) values ('pilot-owner@example.test');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000101',true);
select public.create_pilot_household('Synthetic kitchen','America/New_York');
select public.add_grocery_item('Milk',true);
select public.confirm_purchase(
  jsonb_build_object('merchant','Test Market','purchased_on',current_date::text,
    'lines',jsonb_build_array(jsonb_build_object('name','Milk','quantity',1,'line_total_cents',500)),
    'discount_cents',0,'groceries_subtotal_cents',500,'delivery_cents',200,
    'service_cents',null,'tax_cents',null,'tip_cents',null,'paid_total_cents',700),
  '00000000-0000-4000-8000-000000000201');
select public.set_monthly_budget(date_trunc('month',current_date)::date,10000);

do $$
declare v_payload jsonb := jsonb_build_object('merchant','Test Market','purchased_on',current_date::text,
  'lines',jsonb_build_array(jsonb_build_object('name','Milk','quantity',1,'line_total_cents',500)),
  'discount_cents',0,'groceries_subtotal_cents',500,'delivery_cents',200,
  'service_cents',null,'tax_cents',null,'tip_cents',null,'paid_total_cents',700);
  v_result jsonb;
begin
  if (select count(*) from public.purchases) <> 1 then raise exception 'Purchase not saved exactly once'; end if;
  if (select sum(paid_total_cents) from public.purchases) <> 700 then raise exception 'All-in spend mismatch'; end if;
  if (select count(*) from public.grocery_items where lower(name)='milk') <> 1 then raise exception 'Item identity duplicated'; end if;
  if (select count(*) from public.purchase_lines) <> 1 then raise exception 'Purchase line missing'; end if;
  if (public.get_monthly_budget(date_trunc('month',current_date)::date)->>'spent_cents')::integer <> 700 then
    raise exception 'Budget did not derive confirmed spending';
  end if;
  v_result := public.confirm_purchase(v_payload,'00000000-0000-4000-8000-000000000201');
  if v_result->>'status' <> 'saved' or (select count(*) from public.purchases) <> 1 then
    raise exception 'Idempotent retry created another purchase';
  end if;
  v_result := public.confirm_purchase(v_payload,'00000000-0000-4000-8000-000000000202');
  if v_result->>'status' <> 'duplicate_review' then raise exception 'Duplicate review was bypassed'; end if;
end;
$$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000102',true);
do $$
begin
  if (select count(*) from public.households) <> 0 then raise exception 'Other household was visible'; end if;
  if (select count(*) from public.grocery_items) <> 0 then raise exception 'Other groceries were visible'; end if;
  if (select count(*) from public.purchases) <> 0 then raise exception 'Other purchases were visible'; end if;
  if (select count(*) from public.monthly_budgets) <> 0 then raise exception 'Other budget was visible'; end if;
end;
$$;
rollback;

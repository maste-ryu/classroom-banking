-- Keep a durable, append-only collection row for each successful Pikmin purchase.
begin;

create table public.student_pikmin_collection (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  student_id uuid not null,
  product_id uuid references public.store_products(id) on delete set null,
  transaction_id uuid not null unique references public.transactions(id) on delete cascade,
  product_name text not null,
  acquired_at timestamptz not null default now(),
  foreign key (student_id, classroom_id)
    references public.students(id, classroom_id) on delete cascade
);

create index student_pikmin_collection_student_idx
  on public.student_pikmin_collection(classroom_id, student_id, acquired_at);

alter table public.student_pikmin_collection enable row level security;
revoke all on public.student_pikmin_collection from public, anon, authenticated;

-- Backfill historical Pikmin redemptions so the collection starts complete.
insert into public.student_pikmin_collection (
  classroom_id, student_id, product_id, transaction_id, product_name, acquired_at
)
select t.classroom_id, t.student_id, p.id, t.id, p.name, t.created_at
from public.transactions t
join public.store_products p on p.id = t.product_id
where t.transaction_type = 'purchase'
  and p.product_type = 'pikmin'
on conflict (transaction_id) do nothing;

-- Record each Pikmin redemption in the same transaction as its debit and stock update.
create or replace function public.redeem_product(
  p_classroom_id uuid,
  p_student_id uuid,
  p_product_id uuid,
  p_memo text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_product public.store_products%rowtype;
  v_balance bigint;
  v_transaction_id uuid;
  v_memo text;
begin
  if auth.uid() is null or not private.is_teacher_for(p_classroom_id) then
    raise exception 'not_authorized';
  end if;
  if not exists (
    select 1 from public.students s
    where s.id = p_student_id and s.classroom_id = p_classroom_id and s.is_active
  ) then
    raise exception 'student_not_available';
  end if;
  select * into v_product
  from public.store_products p
  where p.id = p_product_id and p.classroom_id = p_classroom_id and p.is_active
  for update;
  if not found or (v_product.stock_quantity is not null and v_product.stock_quantity < 1) then
    raise exception 'product_not_available';
  end if;
  select coalesce(sum(t.amount), 0) into v_balance
  from public.transactions t where t.student_id = p_student_id;
  if v_balance < 0 then raise exception 'account_in_debt'; end if;
  if v_balance < v_product.price then raise exception 'insufficient_balance'; end if;
  v_memo := '兌換：' || v_product.name;
  if nullif(trim(coalesce(p_memo, '')), '') is not null then
    v_memo := left(v_memo || '；' || trim(p_memo), 240);
  end if;
  insert into public.transactions (
    classroom_id, student_id, transaction_type, amount, product_id, memo, created_by
  ) values (
    p_classroom_id, p_student_id, 'purchase', -v_product.price,
    v_product.id, v_memo, auth.uid()
  ) returning id into v_transaction_id;

  if v_product.product_type = 'pikmin' then
    insert into public.student_pikmin_collection (
      classroom_id, student_id, product_id, transaction_id, product_name
    ) values (
      p_classroom_id, p_student_id, v_product.id, v_transaction_id, v_product.name
    );
  end if;

  if v_product.stock_quantity is not null then
    update public.store_products
    set stock_quantity = stock_quantity - 1, updated_at = now()
    where id = v_product.id;
  end if;
  return v_transaction_id;
end;
$$;
revoke all on function public.redeem_product(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_product(uuid, uuid, uuid, text) to authenticated;

-- Publish the durable collection in the public balance response when enabled.
drop function public.public_classroom_balances();
create function public.public_classroom_balances()
returns table (
  classroom_name text,
  student_name text,
  seat_number integer,
  balance bigint,
  student_photo_path text,
  system_name text,
  transaction_details jsonb,
  public_pikmin_enabled boolean,
  pikmin_collection jsonb
)
language sql stable security definer set search_path = ''
as $$
  select c.name,
         s.name,
         case when c.public_show_seat_numbers then s.seat_number end,
         coalesce(sum(t.amount), 0)::bigint,
         case when c.public_show_student_avatars then s.photo_path end,
         c.system_name,
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'transaction_type', t.transaction_type,
               'amount', t.amount,
               'memo', t.memo,
               'note', t.note,
               'created_at', t.created_at,
               'product_name', case when c.public_pikmin_enabled then p.name end,
               'product_type', case when c.public_pikmin_enabled then p.product_type end
             ) order by t.created_at desc
           ) filter (where t.id is not null),
           '[]'::jsonb
         ),
         c.public_pikmin_enabled,
         case when c.public_pikmin_enabled then coalesce(
           (
             select jsonb_agg(
               jsonb_build_object(
                 'product_name', collection.product_name,
                 'acquired_at', collection.acquired_at
               ) order by collection.acquired_at, collection.id
             )
             from public.student_pikmin_collection collection
             where collection.classroom_id = c.id and collection.student_id = s.id
           ),
           '[]'::jsonb
         ) else '[]'::jsonb end
  from public.classrooms c
  join public.students s on s.classroom_id = c.id
  left join public.transactions t on t.student_id = s.id
  left join public.store_products p on p.id = t.product_id
  where c.public_balances_enabled and s.is_active
  group by c.id, c.name, c.system_name, c.public_show_seat_numbers,
           c.public_show_student_avatars, c.public_pikmin_enabled,
           s.id, s.name, s.seat_number, s.photo_path
  order by s.seat_number nulls last, s.name;
$$;
revoke all on function public.public_classroom_balances() from public, anon, authenticated;
grant execute on function public.public_classroom_balances() to anon, authenticated;

commit;

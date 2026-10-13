-- Add a dedicated virtual Pikmin category and teacher controlled public display.
begin;

alter table public.store_products
  drop constraint if exists store_products_product_type_check;
alter table public.store_products
  add constraint store_products_product_type_check
  check (product_type in ('physical', 'experience', 'pikmin'));

alter table public.classrooms
  add column public_pikmin_enabled boolean not null default true;
grant update (public_pikmin_enabled) on public.classrooms to authenticated;

-- Public account details already include purchases. Add the catalog details so
-- the homepage can show which Pikmin each student has redeemed.
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
  public_pikmin_enabled boolean
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
         c.public_pikmin_enabled
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

drop function public.public_classroom_store();
create function public.public_classroom_store()
returns table (
  classroom_name text,
  product_name text,
  product_type text,
  description text,
  price integer,
  stock_quantity integer,
  system_name text,
  product_photo_path text,
  public_pikmin_enabled boolean
)
language sql stable security definer set search_path = ''
as $$
  select c.name,
         p.name,
         p.product_type,
         p.description,
         p.price,
         p.stock_quantity,
         c.system_name,
         p.photo_path,
         c.public_pikmin_enabled
  from public.classrooms c
  join public.store_products p on p.classroom_id = c.id
  where c.public_balances_enabled and p.is_active
  order by p.name;
$$;
revoke all on function public.public_classroom_store() from public, anon, authenticated;
grant execute on function public.public_classroom_store() to anon, authenticated;

commit;

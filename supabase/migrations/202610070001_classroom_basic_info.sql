-- Let teachers customize the application and classroom names shown in the UI.
alter table public.classrooms
  add column system_name text not null default '班級薪資銀行'
    check (char_length(trim(system_name)) between 1 and 100);

grant update (name, system_name) on public.classrooms to authenticated;

-- Include the public-facing system name in the existing anonymous read APIs.
drop function public.public_classroom_balances();
create function public.public_classroom_balances()
returns table (
  classroom_name text,
  student_name text,
  seat_number integer,
  balance bigint,
  student_photo_path text,
  system_name text
)
language sql stable security definer set search_path = ''
as $$
  select c.name,
         s.name,
         case when c.public_show_seat_numbers then s.seat_number end,
         coalesce(sum(t.amount), 0)::bigint,
         case when c.public_show_student_avatars then s.photo_path end,
         c.system_name
  from public.classrooms c
  join public.students s on s.classroom_id = c.id
  left join public.transactions t on t.student_id = s.id
  where c.public_balances_enabled and s.is_active
  group by c.id, c.name, c.system_name, c.public_show_seat_numbers,
           c.public_show_student_avatars, s.id, s.name, s.seat_number, s.photo_path
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
  system_name text
)
language sql stable security definer set search_path = ''
as $$
  select c.name, p.name, p.product_type, p.description, p.price,
         p.stock_quantity, c.system_name
  from public.classrooms c
  join public.store_products p on p.classroom_id = c.id
  where c.public_balances_enabled and p.is_active
  order by p.name;
$$;
revoke all on function public.public_classroom_store() from public, anon, authenticated;
grant execute on function public.public_classroom_store() to anon, authenticated;

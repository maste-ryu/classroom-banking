-- Publish a single classroom's active student names and current balances.
-- The RPC intentionally returns no student IDs, photos, or ledger entries.
alter table public.classrooms
  add column public_balances_enabled boolean not null default false;

-- This app currently uses one classroom. Enable it automatically only when the
-- database has exactly one, avoiding accidental publication across multiple classes.
do $$
begin
  if (select count(*) from public.classrooms) = 1 then
    update public.classrooms set public_balances_enabled = true;
  end if;
end $$;

create unique index classrooms_single_public_balances_idx
  on public.classrooms (public_balances_enabled)
  where public_balances_enabled;

create function public.public_classroom_balances()
returns table (classroom_name text, student_name text, seat_number integer, balance bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select c.name,
         s.name,
         s.seat_number,
         coalesce(sum(t.amount), 0)::bigint
  from public.classrooms c
  join public.students s on s.classroom_id = c.id
  left join public.transactions t on t.student_id = s.id
  where c.public_balances_enabled
    and s.is_active
  group by c.id, c.name, s.id, s.name, s.seat_number
  order by s.seat_number nulls last, s.name;
$$;

revoke all on function public.public_classroom_balances() from public, anon, authenticated;
grant execute on function public.public_classroom_balances() to anon, authenticated;

-- Add an optional teacher-entered note separate from the selected transaction item.
alter table public.transactions
  add column note text,
  add constraint transactions_note_length_check
    check (note is null or char_length(note) <= 240);

-- Include transaction notes in the public student ledger.
create or replace function public.public_classroom_balances()
returns table (
  classroom_name text,
  student_name text,
  seat_number integer,
  balance bigint,
  student_photo_path text,
  system_name text,
  transaction_details jsonb
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
               'created_at', t.created_at
             ) order by t.created_at desc
           ) filter (where t.id is not null),
           '[]'::jsonb
         )
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

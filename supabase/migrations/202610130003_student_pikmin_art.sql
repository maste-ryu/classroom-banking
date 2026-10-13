-- Give each student a teacher-managed Pikmin illustration for the public balance card.
begin;

alter table public.students
  add column pikmin_photo_path text;

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
  pikmin_collection jsonb,
  student_pikmin_photo_path text
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
         ) else '[]'::jsonb end,
         case when c.public_pikmin_enabled then s.pikmin_photo_path end
  from public.classrooms c
  join public.students s on s.classroom_id = c.id
  left join public.transactions t on t.student_id = s.id
  left join public.store_products p on p.id = t.product_id
  where c.public_balances_enabled and s.is_active
  group by c.id, c.name, c.system_name, c.public_show_seat_numbers,
           c.public_show_student_avatars, c.public_pikmin_enabled,
           s.id, s.name, s.seat_number, s.photo_path, s.pikmin_photo_path
  order by s.seat_number nulls last, s.name;
$$;
revoke all on function public.public_classroom_balances() from public, anon, authenticated;
grant execute on function public.public_classroom_balances() to anon, authenticated;

create function private.can_view_public_student_pikmin_photo(p_object_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.students s
    join public.classrooms c on c.id = s.classroom_id
    where s.pikmin_photo_path = p_object_name
      and s.is_active
      and c.public_balances_enabled
      and c.public_pikmin_enabled
  );
$$;
grant usage on schema private to anon;
revoke all on function private.can_view_public_student_pikmin_photo(text) from public, anon, authenticated;
grant execute on function private.can_view_public_student_pikmin_photo(text) to anon;
grant select on storage.objects to anon;

create policy student_pikmin_photos_public_read
  on storage.objects for select to anon
  using (
    bucket_id = 'student-photos'
    and (select private.can_view_public_student_pikmin_photo(name))
  );

commit;

-- Add teacher-controlled options for the public student homepage.
alter table public.classrooms
  add column public_show_student_avatars boolean not null default false,
  add column public_show_seat_numbers boolean not null default true;

grant update (public_show_student_avatars, public_show_seat_numbers)
  on public.classrooms to authenticated;

create policy classroom_teacher_update_public_settings
  on public.classrooms for update to authenticated
  using ((select private.is_teacher_for(id)))
  with check ((select private.is_teacher_for(id)));

-- The public balance RPC only returns photo paths when the teacher has enabled
-- avatar display. The underlying Storage bucket remains private.
drop function public.public_classroom_balances();

create function public.public_classroom_balances()
returns table (
  classroom_name text,
  student_name text,
  seat_number integer,
  balance bigint,
  student_photo_path text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.name,
         s.name,
         case when c.public_show_seat_numbers then s.seat_number end,
         coalesce(sum(t.amount), 0)::bigint,
         case when c.public_show_student_avatars then s.photo_path end
  from public.classrooms c
  join public.students s on s.classroom_id = c.id
  left join public.transactions t on t.student_id = s.id
  where c.public_balances_enabled
    and s.is_active
  group by c.id, c.name, c.public_show_seat_numbers,
           c.public_show_student_avatars, s.id, s.name, s.seat_number, s.photo_path
  order by s.seat_number nulls last, s.name;
$$;

revoke all on function public.public_classroom_balances() from public, anon, authenticated;
grant execute on function public.public_classroom_balances() to anon, authenticated;

-- Allow anonymous signed-URL creation only for active student photos explicitly
-- published through the classroom setting. The bucket stays private and URLs expire.
create function private.can_view_public_student_photo(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.students s
    join public.classrooms c on c.id = s.classroom_id
    where s.photo_path = p_object_name
      and s.is_active
      and c.public_show_student_avatars
  );
$$;

grant usage on schema private to anon;
revoke all on function private.can_view_public_student_photo(text) from public, anon, authenticated;
grant execute on function private.can_view_public_student_photo(text) to anon;
grant select on storage.objects to anon;

create policy student_photos_public_avatar_read
  on storage.objects for select to anon
  using (
    bucket_id = 'student-photos'
    and (select private.can_view_public_student_photo(name))
  );

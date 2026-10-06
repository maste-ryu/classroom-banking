-- 1) First create your teacher user in Supabase Dashboard > Authentication > Users.
-- 2) Replace the email and classroom name below, then run this in SQL Editor.
do $$
declare
  teacher_uuid uuid;
  classroom_uuid uuid;
begin
  select id into teacher_uuid from auth.users where email = 'YOUR-TEACHER-EMAIL@example.com';
  if teacher_uuid is null then
    raise exception 'Create the teacher account in Supabase Auth and replace the email in this script.';
  end if;

  insert into public.profiles(id, display_name, role)
  values (teacher_uuid, '教師', 'teacher')
  on conflict (id) do update set display_name = excluded.display_name, role = 'teacher';

  insert into public.classrooms(name, public_balances_enabled)
  values ('我的班級', true) returning id into classroom_uuid;
  insert into public.classroom_members(classroom_id, user_id, role)
  values (classroom_uuid, teacher_uuid, 'teacher')
  on conflict (classroom_id, user_id) do update set role = 'teacher';
end $$;

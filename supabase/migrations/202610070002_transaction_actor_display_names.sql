-- Let teachers see display names for users who have recorded transactions
-- in their classrooms, without exposing unrelated profile data.
create policy profile_teacher_transaction_actor_read
  on public.profiles for select to authenticated
  using (
    exists (
      select 1
      from public.transactions t
      where t.created_by = profiles.id
        and (select private.is_teacher_for(t.classroom_id))
    )
  );

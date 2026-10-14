-- Allow teachers to add a Pikmin to a student's collection without creating a purchase.
begin;

alter table public.student_pikmin_collection
  alter column transaction_id drop not null,
  add column granted_by uuid references auth.users(id) on delete set null;

-- Disable new store redemptions; historical purchase transactions remain readable.
revoke execute on function public.redeem_product(uuid, uuid, uuid, text) from authenticated;

create function public.teacher_add_student_pikmin(
  p_classroom_id uuid,
  p_student_id uuid,
  p_product_id uuid
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_product public.store_products%rowtype;
  v_collection_id uuid;
begin
  if auth.uid() is null or not private.is_teacher_for(p_classroom_id) then
    raise exception 'not_authorized';
  end if;

  if not exists (
    select 1 from public.students s
    where s.id = p_student_id
      and s.classroom_id = p_classroom_id
      and s.is_active
  ) then
    raise exception 'student_not_available';
  end if;

  select * into v_product
  from public.store_products p
  where p.id = p_product_id
    and p.classroom_id = p_classroom_id
    and p.product_type = 'pikmin'
    and p.is_active;
  if not found then
    raise exception 'pikmin_not_available';
  end if;

  insert into public.student_pikmin_collection (
    classroom_id, student_id, product_id, transaction_id, product_name, granted_by
  ) values (
    p_classroom_id, p_student_id, v_product.id, null, v_product.name, auth.uid()
  ) returning id into v_collection_id;

  return v_collection_id;
end;
$$;

revoke all on function public.teacher_add_student_pikmin(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.teacher_add_student_pikmin(uuid, uuid, uuid) to authenticated;

commit;

-- Restore regular classroom-store redemptions while keeping Pikmin grant-only.
begin;

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
  if not found or v_product.product_type = 'pikmin'
     or (v_product.stock_quantity is not null and v_product.stock_quantity < 1) then
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

commit;

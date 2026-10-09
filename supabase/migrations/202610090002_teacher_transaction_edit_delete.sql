-- Let teachers correct transaction item, note, and amount from the ledger.
grant update (memo, note, amount) on public.transactions to authenticated;

drop policy if exists transaction_teacher_update on public.transactions;
create policy transaction_teacher_update on public.transactions for update to authenticated
  using ((select private.is_teacher_for(classroom_id)))
  with check ((select private.is_teacher_for(classroom_id)));

-- Delete through a guarded RPC so redeemed stock is returned with the ledger row.
create or replace function public.delete_transaction(p_transaction_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_transaction public.transactions%rowtype;
begin
  select * into v_transaction
  from public.transactions
  where id = p_transaction_id
  for update;

  if not found then
    raise exception 'transaction_not_found';
  end if;

  if not private.is_teacher_for(v_transaction.classroom_id) then
    raise exception 'teacher_only';
  end if;

  if v_transaction.transaction_type = 'purchase' and v_transaction.product_id is not null then
    update public.store_products
    set stock_quantity = stock_quantity + 1,
        updated_at = now()
    where id = v_transaction.product_id
      and classroom_id = v_transaction.classroom_id
      and stock_quantity is not null;
  end if;

  delete from public.transactions where id = p_transaction_id;
end;
$$;

revoke all on function public.delete_transaction(uuid) from public, anon, authenticated;
grant execute on function public.delete_transaction(uuid) to authenticated;

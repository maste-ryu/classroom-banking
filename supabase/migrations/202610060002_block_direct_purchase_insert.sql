-- Purchases must go through redeem_product so balance and inventory change atomically.
drop policy if exists transaction_teacher_insert on public.transactions;

create policy transaction_teacher_insert on public.transactions
for insert to authenticated
with check (
  (select private.is_teacher_for(classroom_id))
  and created_by=(select auth.uid())
  and transaction_type<>'purchase'
);

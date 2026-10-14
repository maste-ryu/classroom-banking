-- Let classroom teachers remove Pikmin display entries. Collection rows and
-- historical transaction rows keep their copied Pikmin names; their product
-- references are set to null by the existing foreign keys.
begin;

alter table public.store_products
  alter column price drop not null,
  drop constraint store_products_price_check;

update public.store_products set price = null where product_type = 'pikmin';

alter table public.store_products
  add constraint store_products_price_check
  check (
    (product_type = 'pikmin' and price is null)
    or (product_type <> 'pikmin' and price is not null and price > 0)
  );

grant delete on public.store_products to authenticated;

create policy product_teacher_delete
  on public.store_products for delete to authenticated
  using (product_type = 'pikmin' and (select private.is_teacher_for(classroom_id)));

commit;

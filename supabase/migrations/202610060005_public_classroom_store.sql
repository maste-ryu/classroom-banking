-- Provide a read-only public listing of active products for the classroom whose
-- balance page is enabled. Product table access remains restricted to members.
create function public.public_classroom_store()
returns table (
  classroom_name text,
  product_name text,
  product_type text,
  description text,
  price integer,
  stock_quantity integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.name,
         p.name,
         p.product_type,
         p.description,
         p.price,
         p.stock_quantity
  from public.classrooms c
  join public.store_products p on p.classroom_id = c.id
  where c.public_balances_enabled
    and p.is_active
  order by p.name;
$$;

revoke all on function public.public_classroom_store() from public, anon, authenticated;
grant execute on function public.public_classroom_store() to anon, authenticated;

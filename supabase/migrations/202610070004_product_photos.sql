-- Store product photos privately and expose short-lived signed URLs for active
-- products in classrooms that publish the public storefront.
alter table public.store_products
  add column photo_path text;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos', 'product-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = excluded.allowed_mime_types;

create function private.can_manage_product_photo(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.classroom_members m
    where m.classroom_id::text = split_part(p_object_name, '/', 1)
      and m.user_id = (select auth.uid())
      and m.role = 'teacher'
  );
$$;

create function private.can_view_public_product_photo(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.store_products p
    join public.classrooms c on c.id = p.classroom_id
    where p.photo_path = p_object_name
      and p.is_active
      and c.public_balances_enabled
  );
$$;

grant usage on schema private to anon, authenticated;
revoke all on function private.can_manage_product_photo(text) from public, anon, authenticated;
revoke all on function private.can_view_public_product_photo(text) from public, anon, authenticated;
grant execute on function private.can_manage_product_photo(text) to authenticated;
grant execute on function private.can_view_public_product_photo(text) to anon, authenticated;
grant select on storage.objects to anon;

create policy product_photos_teacher_all
  on storage.objects for all to authenticated
  using (
    bucket_id = 'product-photos'
    and (select private.can_manage_product_photo(name))
  )
  with check (
    bucket_id = 'product-photos'
    and (select private.can_manage_product_photo(name))
  );

create policy product_photos_public_read
  on storage.objects for select to anon
  using (
    bucket_id = 'product-photos'
    and (select private.can_view_public_product_photo(name))
  );

drop function public.public_classroom_store();
create function public.public_classroom_store()
returns table (
  classroom_name text,
  product_name text,
  product_type text,
  description text,
  price integer,
  stock_quantity integer,
  system_name text,
  product_photo_path text
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
         p.stock_quantity,
         c.system_name,
         p.photo_path
  from public.classrooms c
  join public.store_products p on p.classroom_id = c.id
  where c.public_balances_enabled
    and p.is_active
  order by p.name;
$$;
revoke all on function public.public_classroom_store() from public, anon, authenticated;
grant execute on function public.public_classroom_store() to anon, authenticated;

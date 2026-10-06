-- Initial Supabase schema: immutable account ledger, teacher controls, student read-only access.
create extension if not exists pgcrypto;
create schema if not exists private;

create table public.classrooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 100),
  created_at timestamptz not null default now()
);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null default 'student' check (role in ('teacher','student')),
  created_at timestamptz not null default now()
);
create table public.classroom_members (
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('teacher','student')),
  created_at timestamptz not null default now(),
  primary key (classroom_id,user_id)
);
create table public.students (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  seat_number integer check (seat_number is null or seat_number > 0),
  linked_user_id uuid unique references public.profiles(id) on delete set null,
  photo_path text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id,classroom_id)
);
create unique index students_classroom_seat_unique on public.students(classroom_id,seat_number) where seat_number is not null and is_active;
create table public.behaviors (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  category text not null default '其他',
  transaction_type text not null check (transaction_type in ('reward','penalty')),
  amount integer not null check (amount > 0),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.store_products (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  product_type text not null default 'physical' check (product_type in ('physical','experience')),
  description text,
  price integer not null check (price > 0),
  stock_quantity integer check (stock_quantity is null or stock_quantity >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  transaction_type text not null check (transaction_type in ('reward','penalty','purchase','adjustment')),
  amount integer not null check (
    amount <> 0 and ((transaction_type = 'reward' and amount > 0) or
    (transaction_type in ('penalty','purchase') and amount < 0) or transaction_type = 'adjustment')
  ),
  behavior_id uuid references public.behaviors(id) on delete set null,
  product_id uuid references public.store_products(id) on delete set null,
  memo text not null check (char_length(trim(memo)) between 1 and 240),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (student_id,classroom_id) references public.students(id,classroom_id)
);
create index transactions_student_date_idx on public.transactions(student_id,created_at desc);
create index transactions_class_date_idx on public.transactions(classroom_id,created_at desc);
create view public.account_balances with (security_invoker=true) as
  select s.id as student_id,s.classroom_id,coalesce(sum(t.amount),0)::bigint as balance
  from public.students s left join public.transactions t on t.student_id=s.id
  where s.is_active group by s.id,s.classroom_id;

create function private.is_teacher_for(p_classroom_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.classroom_members m where m.classroom_id=p_classroom_id and m.user_id=(select auth.uid()) and m.role='teacher');
$$;
create function private.can_view_student(p_student_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.students s where s.id=p_student_id and s.linked_user_id=(select auth.uid()));
$$;
grant usage on schema private to authenticated;
revoke all on function private.is_teacher_for(uuid), private.can_view_student(uuid) from public,anon;
grant execute on function private.is_teacher_for(uuid), private.can_view_student(uuid) to authenticated;

alter table public.classrooms enable row level security;
alter table public.profiles enable row level security;
alter table public.classroom_members enable row level security;
alter table public.students enable row level security;
alter table public.behaviors enable row level security;
alter table public.store_products enable row level security;
alter table public.transactions enable row level security;
revoke all on public.classrooms,public.profiles,public.classroom_members,public.students,public.behaviors,public.store_products,public.transactions from anon,authenticated;
grant select on public.classrooms,public.profiles,public.classroom_members,public.students,public.behaviors,public.store_products,public.transactions to authenticated;
grant select on public.account_balances to authenticated;
grant insert,update on public.students,public.behaviors,public.store_products to authenticated;
grant insert on public.transactions to authenticated;

create policy classroom_member_read on public.classrooms for select to authenticated using
  (exists (select 1 from public.classroom_members m where m.classroom_id=id and m.user_id=(select auth.uid())));
create policy profile_self_read on public.profiles for select to authenticated using (id=(select auth.uid()));
create policy member_self_or_teacher_read on public.classroom_members for select to authenticated using
  (user_id=(select auth.uid()) or (select private.is_teacher_for(classroom_id)));
create policy student_class_read on public.students for select to authenticated using
  ((select private.is_teacher_for(classroom_id)) or linked_user_id=(select auth.uid()));
create policy student_teacher_insert on public.students for insert to authenticated with check
  ((select private.is_teacher_for(classroom_id)));
create policy student_teacher_update on public.students for update to authenticated using
  ((select private.is_teacher_for(classroom_id))) with check ((select private.is_teacher_for(classroom_id)));
create policy behavior_teacher_read on public.behaviors for select to authenticated using
  ((select private.is_teacher_for(classroom_id)));
create policy behavior_teacher_insert on public.behaviors for insert to authenticated with check
  ((select private.is_teacher_for(classroom_id)));
create policy behavior_teacher_update on public.behaviors for update to authenticated using
  ((select private.is_teacher_for(classroom_id))) with check ((select private.is_teacher_for(classroom_id)));
create policy product_member_read on public.store_products for select to authenticated using
  ((select private.is_teacher_for(classroom_id)) or exists (
    select 1 from public.classroom_members m where m.classroom_id=store_products.classroom_id and m.user_id=(select auth.uid()) and m.role='student'
  ));
create policy product_teacher_insert on public.store_products for insert to authenticated with check
  ((select private.is_teacher_for(classroom_id)));
create policy product_teacher_update on public.store_products for update to authenticated using
  ((select private.is_teacher_for(classroom_id))) with check ((select private.is_teacher_for(classroom_id)));
create policy transaction_member_read on public.transactions for select to authenticated using
  ((select private.is_teacher_for(classroom_id)) or (select private.can_view_student(student_id)));
create policy transaction_teacher_insert on public.transactions for insert to authenticated with check
  ((select private.is_teacher_for(classroom_id)) and created_by=(select auth.uid()) and transaction_type<>'purchase');

-- The purchase and inventory decrement run atomically; clients cannot write purchase rows directly.
create function public.redeem_product(p_classroom_id uuid,p_student_id uuid,p_product_id uuid,p_memo text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_product public.store_products%rowtype; v_balance bigint; v_transaction_id uuid; v_memo text;
begin
  if auth.uid() is null or not private.is_teacher_for(p_classroom_id) then raise exception 'not_authorized'; end if;
  if not exists (select 1 from public.students s where s.id=p_student_id and s.classroom_id=p_classroom_id and s.is_active) then raise exception 'student_not_available'; end if;
  select * into v_product from public.store_products p where p.id=p_product_id and p.classroom_id=p_classroom_id and p.is_active for update;
  if not found or (v_product.stock_quantity is not null and v_product.stock_quantity<1) then raise exception 'product_not_available'; end if;
  select coalesce(sum(t.amount),0) into v_balance from public.transactions t where t.student_id=p_student_id;
  if v_balance<0 then raise exception 'account_in_debt'; end if;
  if v_balance<v_product.price then raise exception 'insufficient_balance'; end if;
  v_memo := '兌換：'||v_product.name;
  if nullif(trim(coalesce(p_memo,'')),'') is not null then v_memo:=left(v_memo||'；'||trim(p_memo),240); end if;
  insert into public.transactions(classroom_id,student_id,transaction_type,amount,product_id,memo,created_by)
  values(p_classroom_id,p_student_id,'purchase',-v_product.price,v_product.id,v_memo,auth.uid()) returning id into v_transaction_id;
  if v_product.stock_quantity is not null then update public.store_products set stock_quantity=stock_quantity-1,updated_at=now() where id=v_product.id; end if;
  return v_transaction_id;
end;
$$;
revoke all on function public.redeem_product(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.redeem_product(uuid,uuid,uuid,text) to authenticated;

-- Private photo bucket. Object path format: classroom UUID / student UUID / filename.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('student-photos','student-photos',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;
create function private.can_manage_photo_path(p_classroom text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.classroom_members m where m.classroom_id::text=p_classroom and m.user_id=(select auth.uid()) and m.role='teacher');
$$;
create function private.can_view_photo_path(p_classroom text,p_student text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.students s where s.classroom_id::text=p_classroom and s.id::text=p_student and s.linked_user_id=(select auth.uid()));
$$;
grant execute on function private.can_manage_photo_path(text),private.can_view_photo_path(text,text) to authenticated;
revoke all on function private.can_manage_photo_path(text),private.can_view_photo_path(text,text) from public,anon;
create policy student_photos_teacher_all on storage.objects for all to authenticated
  using (bucket_id='student-photos' and (select private.can_manage_photo_path((storage.foldername(name))[1])))
  with check (bucket_id='student-photos' and (select private.can_manage_photo_path((storage.foldername(name))[1])));
create policy student_photos_student_read on storage.objects for select to authenticated
  using (bucket_id='student-photos' and (select private.can_view_photo_path((storage.foldername(name))[1],(storage.foldername(name))[2])));

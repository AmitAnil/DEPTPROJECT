-- Approximation of the production schema before the security baseline migration:
-- text status with a CHECK constraint, permissive policies and public buckets.
create table public.profiles (id uuid primary key references auth.users(id), full_name text, email text, designation text, department text, signature_url text);
create table public.reports (id uuid primary key default gen_random_uuid(), owner_id uuid not null, title text, status text not null default 'draft' check (status in ('draft','completed')), data jsonb default '{}', updated_at timestamptz default now(),
    constraint reports_owner_id_fkey foreign key (owner_id) references public.profiles(id));
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, message text, link text, is_read boolean default false, created_at timestamptz default now());
create table public.activity_logs (id uuid primary key default gen_random_uuid(), user_id uuid, user_name text, action_type text, description text, target_id uuid, created_at timestamptz default now());
alter table public.reports enable row level security;
create policy "everyone can do everything" on public.reports for all using (true) with check (true);
insert into storage.buckets values ('reports','reports',true,null), ('signatures','signatures',true,null);
create policy "public read" on storage.objects for select using (true);

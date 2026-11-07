-- =============================================================================
-- DeptDocs: schema + security baseline
-- =============================================================================
-- Safe to run on a fresh project AND on the existing production project:
--   * tables/columns are created only if missing,
--   * every existing RLS policy on the app tables is REPLACED by the policies below,
--   * the `reports` and `signatures` buckets are made PRIVATE (the app now uses
--     short-lived signed URLs; legacy public URLs stored in old rows keep working
--     because the app converts them to signed URLs).
--
-- Apply with the Supabase CLI (`supabase db push`) or paste into the SQL editor.
-- Try it on a staging copy first. See docs/DEPLOYMENT.md.
-- =============================================================================

begin;

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
    id            uuid primary key references auth.users (id) on delete cascade,
    full_name     text,
    email         text,
    designation   text,
    department    text,
    -- Storage reference (sb://signatures/<user-id>/...) or a legacy public URL.
    signature_url text,
    role          text not null default 'faculty',
    created_at    timestamptz not null default now()
);
alter table public.profiles add column if not exists role text not null default 'faculty';

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'profiles_role_check' and conrelid = 'public.profiles'::regclass) then
        alter table public.profiles add constraint profiles_role_check check (role in ('faculty', 'admin'));
    end if;
end $$;

create table if not exists public.reports (
    id             uuid primary key default gen_random_uuid(),
    owner_id       uuid not null,
    title          text not null default 'Untitled Report',
    status         text not null default 'draft',
    data           jsonb not null default '{}'::jsonb,
    admin_feedback text,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    constraint reports_owner_id_fkey foreign key (owner_id) references public.profiles (id) on delete cascade
);
alter table public.reports add column if not exists admin_feedback text;
alter table public.reports add column if not exists updated_at timestamptz not null default now();

-- Allow the new 'approved' status (works whether `status` is text+CHECK or an enum).
do $$
declare
    col_type   text;
    col_schema text;
    col_udt    text;
    c          record;
begin
    select data_type, udt_schema, udt_name into col_type, col_schema, col_udt
    from information_schema.columns
    where table_schema = 'public' and table_name = 'reports' and column_name = 'status';

    if col_type = 'USER-DEFINED' then
        execute format('alter type %I.%I add value if not exists %L', col_schema, col_udt, 'approved');
    else
        for c in
            select conname from pg_constraint
            where conrelid = 'public.reports'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%'
        loop
            execute format('alter table public.reports drop constraint %I', c.conname);
        end loop;
        alter table public.reports add constraint reports_status_check check (status in ('draft', 'completed', 'approved'));
    end if;
end $$;

create index if not exists reports_owner_id_idx on public.reports (owner_id);
create index if not exists reports_status_idx on public.reports (status);

create table if not exists public.collaborators (
    id         uuid primary key default gen_random_uuid(),
    report_id  uuid not null references public.reports (id) on delete cascade,
    user_id    uuid not null references public.profiles (id) on delete cascade,
    role       text not null default 'Editor' check (role in ('Viewer', 'Editor')),
    status     text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
    created_at timestamptz not null default now(),
    unique (report_id, user_id)
);
create index if not exists collaborators_user_id_idx on public.collaborators (user_id);

create table if not exists public.notifications (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references public.profiles (id) on delete cascade,
    title      text not null,
    message    text,
    link       text,
    is_read    boolean not null default false,
    created_at timestamptz not null default now()
);
alter table public.notifications add column if not exists is_read boolean not null default false;
create index if not exists notifications_user_id_idx on public.notifications (user_id, created_at desc);

-- Notification links must stay inside the app (prevents phishing links).
-- NOT VALID: existing rows are not checked, new/updated rows are.
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'notifications_link_internal' and conrelid = 'public.notifications'::regclass) then
        alter table public.notifications
            add constraint notifications_link_internal
            check (link is null or (left(link, 1) = '/' and left(link, 2) not in ('//', '/\')))
            not valid;
    end if;
end $$;

create table if not exists public.activity_logs (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid references public.profiles (id) on delete set null,
    user_name   text,
    action_type text,
    description text,
    target_id   uuid,
    created_at  timestamptz not null default now()
);

-- Who may create an account. An entry is either a full email address or a domain
-- ("christuniversity.in" also allows sub-domains such as "btech.christuniversity.in").
-- If the table is EMPTY, anyone may sign up.
create table if not exists public.signup_allowlist (
    entry      text primary key,
    note       text,
    created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so they can be used inside RLS policies
-- without recursive policy evaluation)
-- -----------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
    select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_report_owner(rid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select exists (select 1 from public.reports where id = rid and owner_id = auth.uid());
$$;

-- Invited (pending) or accepted collaborator. Pending invitees may see the report
-- title so they can decide whether to accept.
create or replace function public.is_report_member(rid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select exists (
        select 1 from public.collaborators
        where report_id = rid and user_id = auth.uid() and status in ('pending', 'accepted')
    );
$$;

create or replace function public.is_report_editor(rid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select exists (
        select 1 from public.collaborators
        where report_id = rid and user_id = auth.uid() and status = 'accepted' and role = 'Editor'
    );
$$;

grant execute on function public.is_admin(), public.is_report_owner(uuid), public.is_report_member(uuid), public.is_report_editor(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Guard triggers (column-level rules RLS cannot express)
-- auth.uid() is NULL for the service role / SQL editor, which may do anything.
-- -----------------------------------------------------------------------------

create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if auth.uid() is null or public.is_admin() then
        return new;
    end if;
    -- Users cannot promote themselves or change their verified email.
    if tg_op = 'INSERT' then
        new.role := 'faculty';
    else
        new.role := old.role;
    end if;
    new.email := (select email from auth.users where id = new.id);
    return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before insert or update on public.profiles
    for each row execute function public.profiles_guard();

create or replace function public.reports_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
    if auth.uid() is null or public.is_admin() then
        return new;
    end if;
    -- Ownership cannot be transferred, and only admins write feedback
    -- (authors may clear it when resubmitting).
    new.owner_id := old.owner_id;
    if new.admin_feedback is not null and new.admin_feedback is distinct from old.admin_feedback then
        new.admin_feedback := old.admin_feedback;
    end if;
    return new;
end $$;

drop trigger if exists reports_guard on public.reports;
create trigger reports_guard before update on public.reports
    for each row execute function public.reports_guard();

create or replace function public.collaborators_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
    if auth.uid() is null or public.is_admin() then
        return new;
    end if;
    new.report_id := old.report_id;
    new.user_id := old.user_id;
    if public.is_report_owner(old.report_id) then
        -- The owner manages roles; only the invitee answers the invitation.
        new.status := old.status;
    else
        -- The invitee may only accept or decline.
        new.role := old.role;
        if new.status not in ('accepted', 'declined') then
            new.status := old.status;
        end if;
    end if;
    return new;
end $$;

drop trigger if exists collaborators_guard on public.collaborators;
create trigger collaborators_guard before update on public.collaborators
    for each row execute function public.collaborators_guard();

create or replace function public.enforce_signup_allowlist()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
    addr   text := lower(coalesce(new.email, ''));
    domain text := split_part(lower(coalesce(new.email, '')), '@', 2);
begin
    if not exists (select 1 from public.signup_allowlist) then
        return new;
    end if;
    if exists (
        select 1 from public.signup_allowlist a
        where lower(a.entry) = addr or lower(a.entry) = domain or domain like '%.' || lower(a.entry)
    ) then
        return new;
    end if;
    raise exception 'signup_not_allowed: % is not allowed to sign up', new.email using errcode = 'P0001';
end $$;

drop trigger if exists enforce_signup_allowlist on auth.users;
create trigger enforce_signup_allowlist before insert on auth.users
    for each row execute function public.enforce_signup_allowlist();

-- -----------------------------------------------------------------------------
-- Row level security: drop whatever policies exist on the app tables, then
-- recreate a known set.
-- -----------------------------------------------------------------------------

do $$
declare
    p record;
begin
    for p in
        select schemaname, tablename, policyname from pg_policies
        where schemaname = 'public'
          and tablename in ('profiles', 'reports', 'collaborators', 'notifications', 'activity_logs', 'signup_allowlist')
    loop
        execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    end loop;
end $$;

alter table public.profiles         enable row level security;
alter table public.reports          enable row level security;
alter table public.collaborators    enable row level security;
alter table public.notifications    enable row level security;
alter table public.activity_logs    enable row level security;
alter table public.signup_allowlist enable row level security; -- no policies: service role only

-- profiles: everyone signed in can look colleagues up (invites, staff directory);
-- people can only edit their own row.
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated
    using (id = auth.uid() or public.is_admin())
    with check (id = auth.uid() or public.is_admin());

-- reports
create policy reports_select on public.reports for select to authenticated
    using (owner_id = auth.uid() or public.is_admin() or public.is_report_member(id));
create policy reports_insert on public.reports for insert to authenticated
    with check (public.is_admin() or (owner_id = auth.uid() and status::text in ('draft', 'completed')));
-- Drafts are editable by the owner and accepted editors; submitted reports are locked.
-- Only admins (or the server, via the service role) can set 'approved'.
create policy reports_update on public.reports for update to authenticated
    using (public.is_admin() or (status::text = 'draft' and (owner_id = auth.uid() or public.is_report_editor(id))))
    with check (public.is_admin() or status::text in ('draft', 'completed'));
create policy reports_delete on public.reports for delete to authenticated
    using (public.is_admin() or (owner_id = auth.uid() and status::text = 'draft'));

-- collaborators
create policy collaborators_select on public.collaborators for select to authenticated
    using (user_id = auth.uid() or public.is_admin() or public.is_report_owner(report_id) or public.is_report_member(report_id));
create policy collaborators_insert on public.collaborators for insert to authenticated
    with check ((public.is_report_owner(report_id) or public.is_admin()) and status = 'pending' and user_id <> auth.uid());
create policy collaborators_update on public.collaborators for update to authenticated
    using (user_id = auth.uid() or public.is_admin() or public.is_report_owner(report_id))
    with check (user_id = auth.uid() or public.is_admin() or public.is_report_owner(report_id));
create policy collaborators_delete on public.collaborators for delete to authenticated
    using (user_id = auth.uid() or public.is_admin() or public.is_report_owner(report_id));

-- notifications: private to the recipient. Only admins (and the server) notify others.
create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_insert on public.notifications for insert to authenticated
    with check (user_id = auth.uid() or public.is_admin());
create policy notifications_update on public.notifications for update to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

-- activity_logs: append-only audit trail, readable by admins.
create policy activity_logs_select on public.activity_logs for select to authenticated using (public.is_admin());
create policy activity_logs_insert on public.activity_logs for insert to authenticated with check (user_id = auth.uid());

-- Realtime notifications (postgres_changes respects the RLS policies above).
do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
        alter publication supabase_realtime add table public.notifications;
    end if;
end $$;

-- -----------------------------------------------------------------------------
-- Storage: private buckets + policies
-- Object paths: <report-id or user-id>/<section>/<file>. Legacy signature files are
-- named "<user-id>-<random>.<ext>" at the bucket root.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('reports', 'reports', false, 15728640),
       ('signatures', 'signatures', false, 5242880)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create or replace function public.storage_folder(object_name text)
returns text language sql immutable set search_path = '' as $$
    select coalesce((storage.foldername(object_name))[1], left(object_name, 36));
$$;

create or replace function public.storage_can_read(object_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
    folder text := public.storage_folder(object_name);
begin
    if auth.uid() is null then return false; end if;
    if public.is_admin() or folder = auth.uid()::text then return true; end if;
    if folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;

    -- Folder is a report the reader can see.
    if exists (
        select 1 from public.reports r
        where r.id = folder::uuid and (r.owner_id = auth.uid() or public.is_report_member(r.id))
    ) then
        return true;
    end if;

    -- Folder is a person (files uploaded before the report was first saved, or a
    -- signature) who owns / edits a report the reader can see.
    return exists (
        select 1 from public.reports r
        where (r.owner_id = auth.uid() or public.is_report_member(r.id))
          and (r.owner_id = folder::uuid or exists (
                select 1 from public.collaborators c
                where c.report_id = r.id and c.user_id = folder::uuid and c.status = 'accepted'))
    );
end $$;

create or replace function public.storage_can_write_report_file(object_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
    folder text := (storage.foldername(object_name))[1];
begin
    if auth.uid() is null or folder is null then return false; end if;
    if folder = auth.uid()::text then return true; end if;
    if folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
    return exists (
        select 1 from public.reports r
        where r.id = folder::uuid and r.status::text = 'draft'
          and (r.owner_id = auth.uid() or public.is_report_editor(r.id))
    );
end $$;

grant execute on function public.storage_folder(text), public.storage_can_read(text), public.storage_can_write_report_file(text) to authenticated;

-- Replace existing storage policies that concern these buckets (or apply to every bucket).
do $$
declare
    p record;
begin
    for p in
        select policyname from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and (
              coalesce(qual, '') || coalesce(with_check, '') ~ '(reports|signatures)'
              or coalesce(qual, '') || coalesce(with_check, '') !~ 'bucket_id'
          )
    loop
        raise notice 'Dropping storage policy %', p.policyname;
        execute format('drop policy %I on storage.objects', p.policyname);
    end loop;
end $$;

create policy deptdocs_read on storage.objects for select to authenticated
    using (bucket_id in ('reports', 'signatures') and public.storage_can_read(name));

create policy deptdocs_upload_reports on storage.objects for insert to authenticated
    with check (bucket_id = 'reports' and public.storage_can_write_report_file(name));

create policy deptdocs_upload_signatures on storage.objects for insert to authenticated
    with check (bucket_id = 'signatures' and (storage.foldername(name))[1] = auth.uid()::text);

create policy deptdocs_delete_own on storage.objects for delete to authenticated
    using (bucket_id in ('reports', 'signatures') and owner_id = auth.uid()::text);

-- -----------------------------------------------------------------------------
-- Initial data. Review before applying to a new installation.
-- -----------------------------------------------------------------------------

-- Allow Christ University addresses to sign up. Existing accounts are unaffected.
insert into public.signup_allowlist (entry, note)
values ('christuniversity.in', 'All Christ University addresses, including sub-domains')
on conflict (entry) do nothing;

-- Keep the two administrators that were previously hard-coded in proxy.ts.
-- Matched on the verified login email (auth.users), not profiles.email, which users
-- could edit before this migration. Add admins later in Admin > Users & Access.
update public.profiles p set role = 'admin'
from auth.users u
where u.id = p.id
  and lower(u.email) in ('sakshamsharma614@gmail.com', 'adsechristuniversity400@gmail.com');

commit;

-- =============================================================================
-- DeptDocs: fixes from the security review of PR #1
-- =============================================================================
-- 1. Storage: being a collaborator no longer opens the other person's whole personal
--    folder in the `reports` bucket. Report files live in the report's folder (the
--    app creates the draft before the first upload); personal folders stay readable
--    to report members only in the `signatures` bucket.
-- 2. Notifications: signed-in users may only mark their notifications read. They
--    cannot add rows to the email queue or change delivery state.
-- 3. Email queue: a crashed send is retried 15 minutes after it was CLAIMED (not
--    created), so a backlog is never sent twice.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Storage read access
-- -----------------------------------------------------------------------------

create or replace function public.storage_can_read_object(bucket text, object_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
    folder text := public.storage_folder(object_name);
begin
    if auth.uid() is null then return false; end if;
    if public.is_admin() or folder = auth.uid()::text then return true; end if;
    if folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;

    -- A report folder the reader can see.
    if exists (
        select 1 from public.reports r
        where r.id = folder::uuid and (r.owner_id = auth.uid() or public.is_report_member(r.id))
    ) then
        return true;
    end if;

    -- Signatures of people who share a report with the reader (shown on that report).
    if bucket = 'signatures' then
        return exists (
            select 1 from public.reports r
            where (r.owner_id = auth.uid() or public.is_report_member(r.id))
              and (r.owner_id = folder::uuid or exists (
                    select 1 from public.collaborators c
                    where c.report_id = r.id and c.user_id = folder::uuid and c.status = 'accepted'))
        );
    end if;
    return false;
end $$;

grant execute on function public.storage_can_read_object(text, text) to authenticated;

drop policy if exists deptdocs_read on storage.objects;
create policy deptdocs_read on storage.objects for select to authenticated
    using (bucket_id in ('reports', 'signatures') and public.storage_can_read_object(bucket_id, name));

-- The old single-argument function is no longer used by any policy.
drop function if exists public.storage_can_read(text);

-- -----------------------------------------------------------------------------
-- 2. Notifications: users only toggle is_read
-- -----------------------------------------------------------------------------

alter table public.notifications add column if not exists email_claimed_at timestamptz;

create or replace function public.notifications_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
    -- Service role / SQL editor, admins, and SECURITY DEFINER workflow functions
    -- (which run as their owner, not as "authenticated") are trusted.
    if auth.uid() is null or current_user <> 'authenticated' or public.is_admin() then
        return new;
    end if;
    if tg_op = 'INSERT' then
        new.email_status := 'skipped';
        new.emailed_at := null;
        new.email_error := null;
        new.email_claimed_at := null;
    else
        new.id := old.id;
        new.user_id := old.user_id;
        new.title := old.title;
        new.message := old.message;
        new.link := old.link;
        new.created_at := old.created_at;
        new.email_status := old.email_status;
        new.emailed_at := old.emailed_at;
        new.email_error := old.email_error;
        new.email_claimed_at := old.email_claimed_at;
    end if;
    return new;
end $$;

drop trigger if exists notifications_guard on public.notifications;
create trigger notifications_guard before insert or update on public.notifications
    for each row execute function public.notifications_guard();

-- -----------------------------------------------------------------------------
-- 3. Email queue: retry by claim time
-- -----------------------------------------------------------------------------

create or replace function public.claim_notification_emails(max_count integer default 25)
returns table (id uuid, title text, message text, link text, email text, full_name text, wants_email boolean)
language sql security definer set search_path = '' as $$
    with picked as (
        select n.id from public.notifications n
        where n.created_at > now() - interval '2 days'
          and (
              n.email_status = 'pending'
              -- a worker claimed it but never reported back (crash/timeout)
              or (n.email_status = 'sending' and n.emailed_at is null
                  and coalesce(n.email_claimed_at, n.created_at) < now() - interval '15 minutes')
          )
        order by n.created_at
        limit greatest(1, least(max_count, 100))
        for update skip locked
    ), claimed as (
        update public.notifications n set email_status = 'sending', email_claimed_at = now()
        from picked where n.id = picked.id
        returning n.id, n.user_id, n.title, n.message, n.link
    )
    select c.id, c.title, c.message, c.link, p.email, p.full_name, (p.email_notifications and p.is_active)
    from claimed c join public.profiles p on p.id = c.user_id;
$$;
revoke all on function public.claim_notification_emails(integer) from public, anon, authenticated;
grant execute on function public.claim_notification_emails(integer) to service_role;

commit;

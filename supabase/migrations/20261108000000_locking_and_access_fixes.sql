-- =============================================================================
-- DeptDocs: fixes from the November 2026 code review
-- =============================================================================
-- 1. Storage: files of a submitted or approved report can no longer be deleted.
--    Uploads were already blocked once a report was submitted, but deletes were not,
--    so photos/attachments could disappear from a "locked" report (and from the PDF
--    archived on approval). Removed collaborators also lose the right to delete.
-- 2. Invitations: a PENDING invitee no longer sees the report's content or files.
--    They only see what they need to decide (title, who invited them, role) through
--    public.my_pending_invitations(). Full access starts when they accept.
-- 3. Activity log: the author name and time of an entry are set by the database,
--    so users cannot post feed entries under someone else's name or backdate them.
--
-- Safe to run more than once.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Storage deletes respect the report lock
-- -----------------------------------------------------------------------------

create or replace function public.storage_can_delete_object(bucket text, object_name text, object_owner text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
    folder text := (storage.foldername(object_name))[1];
begin
    -- Only the person who uploaded a file may delete it (unchanged rule).
    if auth.uid() is null or object_owner is distinct from auth.uid()::text then return false; end if;

    -- Signatures and the user's own personal folder.
    if bucket = 'signatures' or folder is null or folder = auth.uid()::text then return true; end if;
    if folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;

    -- A report folder: only while the report is a draft, and only for people who may still edit it.
    return exists (
        select 1 from public.reports r
        where r.id = folder::uuid and r.status::text = 'draft'
          and (r.owner_id = auth.uid() or public.is_report_editor(r.id))
    );
end $$;

grant execute on function public.storage_can_delete_object(text, text, text) to authenticated;

drop policy if exists deptdocs_delete_own on storage.objects;
create policy deptdocs_delete_own on storage.objects for delete to authenticated
    using (bucket_id in ('reports', 'signatures') and public.storage_can_delete_object(bucket_id, name, owner_id));

-- -----------------------------------------------------------------------------
-- 2. Pending invitees are not members yet
-- -----------------------------------------------------------------------------

-- Used by the reports, collaborators and storage policies. Previously this also
-- matched PENDING invitations, which exposed the whole report before accepting.
create or replace function public.is_report_member(rid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select exists (
        select 1 from public.collaborators
        where report_id = rid and user_id = auth.uid() and status = 'accepted'
    );
$$;

-- What an invitee sees before accepting (Settings > Requests).
create or replace function public.my_pending_invitations()
returns table (id uuid, status text, role text, report_id uuid, report_title text, owner_name text, owner_email text)
language sql stable security definer set search_path = '' as $$
    select c.id, c.status::text, c.role::text, r.id, r.title, p.full_name, p.email
    from public.collaborators c
    join public.reports r on r.id = c.report_id
    left join public.profiles p on p.id = r.owner_id
    where c.user_id = auth.uid() and c.status::text = 'pending'
    order by r.title;
$$;

revoke all on function public.my_pending_invitations() from public, anon;
grant execute on function public.my_pending_invitations() to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Activity log entries carry the real author and time
-- -----------------------------------------------------------------------------

create or replace function public.activity_logs_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    -- The server (service role) and SQL editor are trusted as before.
    if auth.uid() is null then
        return new;
    end if;
    new.user_id := auth.uid();
    new.user_name := coalesce(
        (select nullif(trim(full_name), '') from public.profiles where id = auth.uid()),
        (select email from auth.users where id = auth.uid())
    );
    new.created_at := now();
    return new;
end $$;

drop trigger if exists activity_logs_guard on public.activity_logs;
create trigger activity_logs_guard before insert on public.activity_logs
    for each row execute function public.activity_logs_guard();

commit;

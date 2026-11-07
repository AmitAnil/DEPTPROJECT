-- =============================================================================
-- DeptDocs: automatic notifications, email delivery queue, account management
-- =============================================================================
-- * Notifications for workflow events are created by database triggers, so they
--   cannot be skipped or forged from the browser.
-- * Every notification is queued for email (email_status = 'pending'); the app's
--   /api/notifications/dispatch endpoint sends them over SMTP.
-- * profiles.email_notifications: per-user email opt-out.
-- * profiles.is_active: admins can deactivate accounts (the app also bans the
--   login in Supabase Auth). Deactivated admins lose admin rights.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Columns
-- -----------------------------------------------------------------------------

alter table public.profiles add column if not exists email_notifications boolean not null default true;
alter table public.profiles add column if not exists is_active boolean not null default true;

do $$
begin
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'notifications' and column_name = 'email_status') then
        alter table public.notifications add column email_status text not null default 'pending'
            check (email_status in ('pending', 'sending', 'sent', 'skipped', 'failed'));
        -- Never email notifications that existed before this migration.
        update public.notifications set email_status = 'skipped';
    end if;
end $$;
alter table public.notifications add column if not exists emailed_at timestamptz;
alter table public.notifications add column if not exists email_error text;
create index if not exists notifications_email_pending_idx on public.notifications (created_at) where email_status = 'pending';

-- -----------------------------------------------------------------------------
-- Admin rights require an active account
-- -----------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
    select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and is_active);
$$;

-- Users cannot change their own role, email or active flag (extends the baseline guard).
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if auth.uid() is null or public.is_admin() then
        return new;
    end if;
    if tg_op = 'INSERT' then
        new.role := 'faculty';
        new.is_active := true;
    else
        new.role := old.role;
        new.is_active := old.is_active;
    end if;
    new.email := (select email from auth.users where id = new.id);
    return new;
end $$;

-- -----------------------------------------------------------------------------
-- Notifications
-- -----------------------------------------------------------------------------

create or replace function public.notify_user(recipient uuid, title text, message text, link text)
returns void language sql security definer set search_path = '' as $$
    insert into public.notifications (user_id, title, message, link)
    select recipient, title, left(message, 1000), link
    where recipient is not null and exists (select 1 from public.profiles where id = recipient and is_active);
$$;
revoke all on function public.notify_user(uuid, text, text, text) from public, anon, authenticated;

create or replace function public.display_name(uid uuid)
returns text language sql stable security definer set search_path = '' as $$
    select coalesce(nullif(trim(full_name), ''), email, 'Someone') from public.profiles where id = uid;
$$;

create or replace function public.reports_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
    a record;
    report_link text := '/home/new?id=' || new.id;
    title text := coalesce(nullif(trim(new.title), ''), 'Untitled Report');
begin
    if tg_op = 'INSERT' then
        -- Created by someone else (an admin assigning work).
        if auth.uid() is not null and new.owner_id <> auth.uid() then
            perform public.notify_user(new.owner_id, 'New report assigned',
                format('You have been assigned to prepare the report "%s".', title), report_link);
        end if;
    elsif new.status::text is distinct from old.status::text then
        if new.status::text = 'completed' then
            for a in select id from public.profiles where role = 'admin' and is_active loop
                perform public.notify_user(a.id, 'Report submitted for review',
                    format('%s submitted "%s" for review.', public.display_name(new.owner_id), title), '/admin');
            end loop;
        elsif new.status::text = 'draft' and old.status::text = 'completed' then
            perform public.notify_user(new.owner_id, 'Report revision required',
                format('Changes were requested on "%s": %s', title, coalesce(new.admin_feedback, '')), report_link);
        elsif new.status::text = 'approved' then
            perform public.notify_user(new.owner_id, 'Report approved',
                format('Your report "%s" was approved and archived.', title), report_link);
        end if;
    end if;

    -- Submitted straight away on creation.
    if tg_op = 'INSERT' and new.status::text = 'completed' then
        for a in select id from public.profiles where role = 'admin' and is_active loop
            perform public.notify_user(a.id, 'Report submitted for review',
                format('%s submitted "%s" for review.', public.display_name(new.owner_id), title), '/admin');
        end loop;
    end if;
    return new;
end $$;

drop trigger if exists reports_notify on public.reports;
create trigger reports_notify after insert or update of status on public.reports
    for each row execute function public.reports_notify();

create or replace function public.collaborators_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
    r record;
begin
    select id, owner_id, coalesce(nullif(trim(title), ''), 'Untitled Report') as title into r
    from public.reports where id = new.report_id;
    if tg_op = 'INSERT' then
        perform public.notify_user(new.user_id, 'Collaboration invite',
            format('%s invited you to collaborate on "%s" as %s.', public.display_name(r.owner_id), r.title, new.role),
            '/settings?tab=Requests');
    elsif new.status = 'accepted' and old.status is distinct from 'accepted' then
        perform public.notify_user(r.owner_id, 'Invitation accepted',
            format('%s accepted your invitation to "%s".', public.display_name(new.user_id), r.title), '/home/open');
    end if;
    return new;
end $$;

drop trigger if exists collaborators_notify on public.collaborators;
create trigger collaborators_notify after insert or update of status on public.collaborators
    for each row execute function public.collaborators_notify();

-- Workflow notifications now come from the triggers above; admins can still send manual ones.
drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert to authenticated
    with check (user_id = auth.uid() or public.is_admin());

-- -----------------------------------------------------------------------------
-- Email queue (used by the server with the service role only)
-- -----------------------------------------------------------------------------

-- Atomically claims pending notifications for sending (safe with parallel workers).
create or replace function public.claim_notification_emails(max_count integer default 25)
returns table (id uuid, title text, message text, link text, email text, full_name text, wants_email boolean)
language sql security definer set search_path = '' as $$
    with picked as (
        select n.id from public.notifications n
        where (n.email_status = 'pending' and n.created_at > now() - interval '2 days')
           or (n.email_status = 'sending' and n.created_at > now() - interval '2 days' and n.emailed_at is null
               and n.created_at < now() - interval '15 minutes')  -- retry rows a crashed worker left behind
        order by n.created_at
        limit greatest(1, least(max_count, 100))
        for update skip locked
    ), claimed as (
        update public.notifications n set email_status = 'sending'
        from picked where n.id = picked.id
        returning n.id, n.user_id, n.title, n.message, n.link
    )
    select c.id, c.title, c.message, c.link, p.email, p.full_name, (p.email_notifications and p.is_active)
    from claimed c join public.profiles p on p.id = c.user_id;
$$;
revoke all on function public.claim_notification_emails(integer) from public, anon, authenticated;
grant execute on function public.claim_notification_emails(integer) to service_role;

commit;

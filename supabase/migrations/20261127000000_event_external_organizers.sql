-- =============================================================================
-- DeptDocs: event organizers without a DeptDocs account
-- =============================================================================
-- An admin can now type any email address as the organizer of an event.
-- * If that email belongs to a DeptDocs user, nothing changes: they get the report
--   in their to-do list, plus in-app and email notifications.
-- * Otherwise the event keeps the email (and the prefilled report data). The person
--   gets the "event scheduled" email and the daily reminders at that address, and
--   their email is allowed to sign up. As soon as they sign up with it, the event and
--   a prefilled draft report move into their account.
-- * public.outbound_emails is a small queue for emails to addresses without an
--   account; the app sends it together with the normal notification emails.
--
-- Run after 20261126000000_event_calendar.sql. Safe to run more than once.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Events can name an organizer by email
-- -----------------------------------------------------------------------------

alter table public.events alter column organizer_id drop not null;
alter table public.events add column if not exists organizer_email text;
alter table public.events add column if not exists organizer_name text;
-- Kept until the organizer signs up, then used to create their report.
alter table public.events add column if not exists report_data jsonb;
alter table public.events add column if not exists report_template uuid;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'events_report_template_fkey') then
        alter table public.events add constraint events_report_template_fkey
            foreign key (report_template) references public.report_templates (id) on delete set null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'events_has_organizer') then
        alter table public.events add constraint events_has_organizer
            check (organizer_id is not null or organizer_email is not null);
    end if;
end $$;
create index if not exists events_organizer_email_idx on public.events (lower(organizer_email)) where organizer_id is null;

-- -----------------------------------------------------------------------------
-- 2. Emails to addresses without an account (sent by the app's server)
-- -----------------------------------------------------------------------------

create table if not exists public.outbound_emails (
    id               uuid primary key default gen_random_uuid(),
    to_email         text not null,
    to_name          text,
    title            text not null,
    message          text,
    link             text,
    email_status     text not null default 'pending' check (email_status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
    email_claimed_at timestamptz,
    emailed_at       timestamptz,
    email_error      text,
    created_at       timestamptz not null default now()
);
alter table public.outbound_emails enable row level security; -- no policies: server (service role) only
revoke all on public.outbound_emails from anon, authenticated;
grant all on public.outbound_emails to service_role;

create or replace function public.queue_outbound_email(p_to text, p_name text, p_title text, p_message text, p_link text)
returns void language sql security definer set search_path = '' as $$
    insert into public.outbound_emails (to_email, to_name, title, message, link) values (p_to, p_name, p_title, p_message, p_link);
$$;
revoke all on function public.queue_outbound_email(text, text, text, text, text) from public, anon, authenticated;

create or replace function public.claim_outbound_emails(max_count integer default 25)
returns table (id uuid, to_email text, to_name text, title text, message text, link text)
language sql security definer set search_path = '' as $$
    with picked as (
        select o.id from public.outbound_emails o
        where o.created_at > now() - interval '2 days'
          and (o.email_status = 'pending'
               or (o.email_status = 'sending' and o.emailed_at is null
                   and coalesce(o.email_claimed_at, o.created_at) < now() - interval '15 minutes'))
        order by o.created_at
        limit greatest(1, least(max_count, 100))
        for update skip locked
    )
    update public.outbound_emails o set email_status = 'sending', email_claimed_at = now()
    from picked where o.id = picked.id
    returning o.id, o.to_email, o.to_name, o.title, o.message, o.link;
$$;
revoke all on function public.claim_outbound_emails(integer) from public, anon, authenticated;
grant execute on function public.claim_outbound_emails(integer) to service_role;

-- -----------------------------------------------------------------------------
-- 3. Scheduling (replaces the version without an email option)
-- -----------------------------------------------------------------------------

drop function if exists public.schedule_event(text, date, time, time, uuid, uuid, jsonb, date);

create or replace function public.schedule_event(
    p_title text, p_date date, p_start time, p_end time, p_organizer uuid,
    p_template uuid, p_data jsonb, p_today date,
    p_organizer_email text default null, p_organizer_name text default null
)
returns table (event_id uuid, report_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
    v_report uuid;
    v_event uuid;
    v_title text := btrim(coalesce(p_title, ''));
    v_email text := lower(btrim(coalesce(p_organizer_email, '')));
    v_name text := nullif(btrim(coalesce(p_organizer_name, '')), '');
    v_organizer uuid := p_organizer;
    v_when text;
begin
    if not public.is_admin() then
        raise exception 'Only admins can schedule events.' using errcode = '42501';
    end if;
    if v_title = '' then raise exception 'Please enter the event title.'; end if;
    if p_date is null then raise exception 'Please choose the event date.'; end if;
    if p_start is not null and p_end is not null and p_end < p_start then
        raise exception 'The end time must be after the start time.';
    end if;

    -- A typed email that belongs to a DeptDocs user is treated as picking that user.
    if v_organizer is null and v_email <> '' then
        if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
            raise exception 'Please enter a valid organizer email.';
        end if;
        select id into v_organizer from public.profiles where lower(email) = v_email and is_active limit 1;
        if v_organizer is null and exists (select 1 from public.profiles where lower(email) = v_email) then
            raise exception 'That person''s DeptDocs account is deactivated.';
        end if;
    end if;
    if v_organizer is null and v_email = '' then
        raise exception 'Please choose or type the organizer.';
    end if;

    v_when := to_char(p_date, 'FMDay, FMDD FMMonth YYYY') || coalesce(' at ' || to_char(p_start, 'HH24:MI'), '');

    if v_organizer is not null then
        if not exists (select 1 from public.profiles where id = v_organizer and is_active) then
            raise exception 'Please choose an active organizer.';
        end if;
        insert into public.reports (owner_id, title, status, data, template_id)
        values (v_organizer, v_title, 'draft', coalesce(p_data, '{}'::jsonb), p_template)
        returning id into v_report;

        insert into public.events (title, event_date, start_time, end_time, organizer_id, report_id, created_by, last_reminder_on)
        values (v_title, p_date, p_start, p_end, v_organizer, v_report, auth.uid(), p_today)
        returning id into v_event;

        perform public.notify_user(v_organizer,
            format('Event scheduled: "%s"', v_title),
            format('You are the organizer of "%s" on %s. Please prepare its activity report in DeptDocs. '
                || 'Daily reminders start 7 days before the event and continue until the report is submitted.', v_title, v_when),
            '/home/new?id=' || v_report);
    else
        -- Not on DeptDocs yet: keep the report data on the event until they sign up.
        insert into public.events (title, event_date, start_time, end_time, organizer_id, organizer_email, organizer_name,
                                   report_data, report_template, created_by, last_reminder_on)
        values (v_title, p_date, p_start, p_end, null, v_email, v_name,
                coalesce(p_data, '{}'::jsonb), p_template, auth.uid(), p_today)
        returning id into v_event;

        -- Let them sign up. (An empty allow-list means anyone may sign up; adding an
        -- entry would lock everyone else out, so leave it alone in that case.)
        if exists (select 1 from public.signup_allowlist) then
            insert into public.signup_allowlist (entry, note)
            values (v_email, format('Organizer of "%s" (added automatically)', left(v_title, 100)))
            on conflict (entry) do nothing;
        end if;

        perform public.queue_outbound_email(v_email, v_name,
            format('Event scheduled: "%s"', v_title),
            format('You are the organizer of "%s" on %s. Please sign up to DeptDocs with this email address (%s) '
                || 'to prepare its activity report: the event and a prefilled report will be waiting in your account. '
                || 'Daily reminders start 7 days before the event and continue until the report is submitted.', v_title, v_when, v_email),
            '/signup');
    end if;

    insert into public.activity_logs (user_id, action_type, description, target_id)
    values (auth.uid(), 'EVENT_SCHEDULED',
        format('scheduled "%s" on %s for %s', v_title, to_char(p_date, 'DD Mon YYYY'),
            coalesce(public.display_name(v_organizer), v_name, v_email)), v_event);

    return query select v_event, v_report;
end $$;

revoke all on function public.schedule_event(text, date, time, time, uuid, uuid, jsonb, date, text, text) from public, anon;
grant execute on function public.schedule_event(text, date, time, time, uuid, uuid, jsonb, date, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Cancelling also tells organizers without an account
-- -----------------------------------------------------------------------------

create or replace function public.cancel_event(p_event uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
    e record;
    v_status text;
    v_msg text;
begin
    if not public.is_admin() then
        raise exception 'Only admins can cancel events.' using errcode = '42501';
    end if;
    select * into e from public.events where id = p_event;
    if not found then return; end if;

    select status::text into v_status from public.reports where id = e.report_id;
    delete from public.events where id = p_event;
    if v_status = 'draft' then
        delete from public.reports where id = e.report_id;
    end if;

    v_msg := format('The event "%s" on %s was cancelled.', e.title, to_char(e.event_date, 'FMDay, FMDD FMMonth YYYY'));
    if e.organizer_id is not null then
        perform public.notify_user(e.organizer_id, format('Event cancelled: "%s"', e.title),
            v_msg || case when v_status = 'draft' then ' Its draft report was removed, and you will get no more reminders.' else '' end,
            '/home');
    elsif e.organizer_email is not null then
        perform public.queue_outbound_email(e.organizer_email, e.organizer_name, format('Event cancelled: "%s"', e.title),
            v_msg || ' You will get no more reminders about it.', null);
    end if;

    insert into public.activity_logs (user_id, action_type, description, target_id)
    values (auth.uid(), 'EVENT_CANCELLED', format('cancelled "%s" (%s)', e.title, to_char(e.event_date, 'DD Mon YYYY')), p_event);
end $$;

-- -----------------------------------------------------------------------------
-- 5. Daily reminders also go to organizers without an account
-- -----------------------------------------------------------------------------

create or replace function public.queue_event_reminders(p_today date)
returns integer language plpgsql security definer set search_path = '' as $$
declare
    e record;
    v_days integer;
    v_title text;
    v_message text;
    v_count integer := 0;
begin
    for e in
        select ev.id, ev.title, ev.event_date, ev.organizer_id, ev.report_id, ev.organizer_email, ev.organizer_name
        from public.events ev
        left join public.reports r on r.id = ev.report_id
        left join public.profiles p on p.id = ev.organizer_id
        where p_today >= ev.event_date - 7
          and (ev.last_reminder_on is null or ev.last_reminder_on < p_today)
          and (
              -- a DeptDocs user whose report is not submitted yet
              (ev.organizer_id is not null and r.status::text = 'draft' and p.is_active)
              -- or someone who has not signed up yet
              or (ev.organizer_id is null and ev.organizer_email is not null)
          )
        for update of ev skip locked
    loop
        v_days := e.event_date - p_today;
        if v_days > 0 then
            v_title := format('Reminder: "%s" is in %s day%s', e.title, v_days, case when v_days = 1 then '' else 's' end);
            v_message := format('"%s" is on %s. Please prepare its activity report in DeptDocs and submit it after the event.',
                e.title, to_char(e.event_date, 'FMDay, FMDD FMMonth YYYY'));
        elsif v_days = 0 then
            v_title := format('Today: "%s"', e.title);
            v_message := format('"%s" is today. Please complete and submit its activity report in DeptDocs.', e.title);
        else
            v_title := format('Report pending: "%s"', e.title);
            v_message := format('"%s" took place on %s (%s day%s ago) and its activity report has not been submitted yet. Please complete and submit it in DeptDocs.',
                e.title, to_char(e.event_date, 'FMDay, FMDD FMMonth YYYY'), -v_days, case when v_days = -1 then '' else 's' end);
        end if;

        if e.organizer_id is not null then
            perform public.notify_user(e.organizer_id, v_title, v_message, '/home/new?id=' || e.report_id);
        else
            perform public.queue_outbound_email(e.organizer_email, e.organizer_name, v_title,
                v_message || format(' Sign up to DeptDocs with %s to find the event and its prefilled report in your account.', e.organizer_email),
                '/signup');
        end if;
        update public.events set last_reminder_on = p_today where id = e.id;
        v_count := v_count + 1;
    end loop;
    return v_count;
end $$;

-- -----------------------------------------------------------------------------
-- 6. When the organizer signs up, their events and reports move into their account
-- -----------------------------------------------------------------------------

create or replace function public.claim_events_for_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
    e record;
    v_report uuid;
begin
    -- profiles.email is the verified sign-in email (set by profiles_guard).
    if new.email is null or (tg_op = 'UPDATE' and new.email is not distinct from old.email) then
        return new;
    end if;
    for e in
        select * from public.events
        where organizer_id is null and lower(organizer_email) = lower(new.email)
        for update
    loop
        insert into public.reports (owner_id, title, status, data, template_id)
        values (new.id, e.title, 'draft', coalesce(e.report_data, '{}'::jsonb), e.report_template)
        returning id into v_report;
        update public.events set organizer_id = new.id, report_id = v_report, report_data = null where id = e.id;
        perform public.notify_user(new.id,
            format('Event assigned to you: "%s"', e.title),
            format('You are the organizer of "%s" on %s. Its report is ready in your to-do list; please prepare it and submit it after the event.',
                e.title, to_char(e.event_date, 'FMDay, FMDD FMMonth YYYY')),
            '/home/new?id=' || v_report);
    end loop;
    return new;
end $$;

drop trigger if exists claim_events_for_profile on public.profiles;
create trigger claim_events_for_profile after insert or update of email on public.profiles
    for each row execute function public.claim_events_for_profile();

-- -----------------------------------------------------------------------------
-- 7. Files of events without a report yet (the NFA) live in a folder named after the event
-- -----------------------------------------------------------------------------

create or replace function public.storage_can_write_report_file(object_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
    folder text := (storage.foldername(object_name))[1];
begin
    if auth.uid() is null or folder is null then return false; end if;
    if folder = auth.uid()::text then return true; end if;
    if folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
    if exists (
        select 1 from public.reports r
        where r.id = folder::uuid and r.status::text = 'draft'
          and (r.owner_id = auth.uid() or public.is_report_editor(r.id) or public.is_admin())
    ) then
        return true;
    end if;
    -- Admins upload the NFA of an event whose organizer has not signed up yet.
    return public.is_admin() and exists (select 1 from public.events ev where ev.id = folder::uuid);
end $$;

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

    -- An event folder: its organizer and the people working on its report.
    if bucket = 'reports' and exists (
        select 1 from public.events ev
        where ev.id = folder::uuid
          and (ev.organizer_id = auth.uid() or (ev.report_id is not null and public.is_report_member(ev.report_id)))
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

commit;

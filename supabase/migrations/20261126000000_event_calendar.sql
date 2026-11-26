-- =============================================================================
-- DeptDocs: event calendar
-- =============================================================================
-- * public.events: activities scheduled by admins on the home-page calendar.
--   Everyone signed in can see the calendar; only admins can add or cancel events.
-- * schedule_event(): creates the event AND a draft report owned by the organizer
--   (so it appears in their to-do list), and emails them.
-- * queue_event_reminders(): queues one reminder per event per day, from 7 days
--   before the event until its report is submitted. The app calls it on a timer.
-- * cancel_event(): removes an event (and its report while still a draft).
-- * Admins may upload files (the NFA) into draft reports.
--
-- Run after the earlier migrations. Safe to run more than once.
-- =============================================================================

begin;

create table if not exists public.events (
    id              uuid primary key default gen_random_uuid(),
    title           text not null,
    event_date      date not null,
    start_time      time,
    end_time        time,
    organizer_id    uuid not null,
    report_id       uuid,
    nfa_ref         text,
    nfa_name        text,
    created_by      uuid,
    created_at      timestamptz not null default now(),
    -- Last day (local date) a reminder was queued; at most one per day.
    last_reminder_on date,
    constraint events_organizer_id_fkey foreign key (organizer_id) references public.profiles (id) on delete cascade,
    constraint events_report_id_fkey foreign key (report_id) references public.reports (id) on delete set null,
    constraint events_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null,
    constraint events_title_length check (length(btrim(title)) between 1 and 300),
    constraint events_time_order check (start_time is null or end_time is null or end_time >= start_time)
);
create index if not exists events_date_idx on public.events (event_date);
create index if not exists events_organizer_idx on public.events (organizer_id);
create unique index if not exists events_report_idx on public.events (report_id) where report_id is not null;

alter table public.events enable row level security;

drop policy if exists events_select on public.events;
create policy events_select on public.events for select to authenticated using (true);

-- Changes go through the functions below; admins may also fix details directly.
drop policy if exists events_admin_update on public.events;
create policy events_admin_update on public.events for update to authenticated
    using (public.is_admin()) with check (public.is_admin());

revoke all on public.events from anon;
grant select, update on public.events to authenticated;
grant all on public.events to service_role;

-- -----------------------------------------------------------------------------
-- Scheduling
-- -----------------------------------------------------------------------------

create or replace function public.schedule_event(
    p_title text, p_date date, p_start time, p_end time, p_organizer uuid,
    p_template uuid, p_data jsonb, p_today date
)
returns table (event_id uuid, report_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
    v_report uuid;
    v_event uuid;
    v_title text := btrim(coalesce(p_title, ''));
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
    if not exists (select 1 from public.profiles where id = p_organizer and is_active) then
        raise exception 'Please choose an active organizer.';
    end if;

    insert into public.reports (owner_id, title, status, data, template_id)
    values (p_organizer, v_title, 'draft', coalesce(p_data, '{}'::jsonb), p_template)
    returning id into v_report;

    insert into public.events (title, event_date, start_time, end_time, organizer_id, report_id, created_by, last_reminder_on)
    values (v_title, p_date, p_start, p_end, p_organizer, v_report, auth.uid(), p_today)
    returning id into v_event;

    v_when := to_char(p_date, 'FMDay, FMDD FMMonth YYYY')
        || coalesce(' at ' || to_char(p_start, 'HH24:MI'), '');
    perform public.notify_user(p_organizer,
        format('Event scheduled: "%s"', v_title),
        format('You are the organizer of "%s" on %s. Please prepare its activity report in DeptDocs. '
            || 'Daily reminders start 7 days before the event and continue until the report is submitted.', v_title, v_when),
        '/home/new?id=' || v_report);

    insert into public.activity_logs (user_id, action_type, description, target_id)
    values (auth.uid(), 'EVENT_SCHEDULED',
        format('scheduled "%s" on %s for %s', v_title, to_char(p_date, 'DD Mon YYYY'), public.display_name(p_organizer)), v_event);

    return query select v_event, v_report;
end $$;

revoke all on function public.schedule_event(text, date, time, time, uuid, uuid, jsonb, date) from public, anon;
grant execute on function public.schedule_event(text, date, time, time, uuid, uuid, jsonb, date) to authenticated;

create or replace function public.cancel_event(p_event uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
    e record;
    v_status text;
begin
    if not public.is_admin() then
        raise exception 'Only admins can cancel events.' using errcode = '42501';
    end if;
    select * into e from public.events where id = p_event;
    if not found then return; end if;

    select status::text into v_status from public.reports where id = e.report_id;
    delete from public.events where id = p_event;
    -- A report still being written belongs to the event; a submitted/approved one is kept.
    if v_status = 'draft' then
        delete from public.reports where id = e.report_id;
    end if;

    perform public.notify_user(e.organizer_id,
        format('Event cancelled: "%s"', e.title),
        format('The event "%s" on %s was cancelled.%s', e.title, to_char(e.event_date, 'FMDay, FMDD FMMonth YYYY'),
            case when v_status = 'draft' then ' Its draft report was removed, and you will get no more reminders.' else '' end),
        '/home');

    insert into public.activity_logs (user_id, action_type, description, target_id)
    values (auth.uid(), 'EVENT_CANCELLED', format('cancelled "%s" (%s)', e.title, to_char(e.event_date, 'DD Mon YYYY')), p_event);
end $$;

revoke all on function public.cancel_event(uuid) from public, anon;
grant execute on function public.cancel_event(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Daily reminders (called by the app's server with the service role)
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
        select ev.id, ev.title, ev.event_date, ev.organizer_id, ev.report_id
        from public.events ev
        join public.reports r on r.id = ev.report_id
        join public.profiles p on p.id = ev.organizer_id
        where r.status::text = 'draft'
          and p.is_active
          and p_today >= ev.event_date - 7
          and (ev.last_reminder_on is null or ev.last_reminder_on < p_today)
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

        perform public.notify_user(e.organizer_id, v_title, v_message, '/home/new?id=' || e.report_id);
        update public.events set last_reminder_on = p_today where id = e.id;
        v_count := v_count + 1;
    end loop;
    return v_count;
end $$;

revoke all on function public.queue_event_reminders(date) from public, anon, authenticated;
grant execute on function public.queue_event_reminders(date) to service_role;

-- -----------------------------------------------------------------------------
-- Admins may upload into draft reports (the NFA when scheduling an event)
-- -----------------------------------------------------------------------------

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
          and (r.owner_id = auth.uid() or public.is_report_editor(r.id) or public.is_admin())
    );
end $$;

commit;

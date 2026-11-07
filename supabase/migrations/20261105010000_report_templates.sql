-- =============================================================================
-- DeptDocs: configurable report templates
-- =============================================================================
-- Admins edit the report structure in /admin/templates. Every save inserts a NEW
-- row (versions are immutable); exactly one row is active and is used for new
-- reports. Each report keeps the version it was created with (reports.template_id).
-- reports.template_id NULL = the built-in template shipped with the app.
-- =============================================================================

begin;

create table if not exists public.report_templates (
    id         uuid primary key default gen_random_uuid(),
    name       text not null check (length(trim(name)) > 0),
    definition jsonb not null check (jsonb_typeof(definition -> 'sections') = 'array'),
    is_active  boolean not null default false,
    created_by uuid references public.profiles (id) on delete set null,
    created_at timestamptz not null default now()
);

create unique index if not exists report_templates_single_active on public.report_templates (is_active) where is_active;

alter table public.reports
    add column if not exists template_id uuid references public.report_templates (id) on delete restrict;

alter table public.report_templates enable row level security;

do $$
declare
    p record;
begin
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'report_templates' loop
        execute format('drop policy %I on public.report_templates', p.policyname);
    end loop;
end $$;

-- Everyone signed in needs templates to open the editor; only admins create them.
-- There is deliberately no UPDATE policy: versions are immutable (activation uses the
-- function below). Unused, inactive versions can be deleted by admins.
create policy report_templates_select on public.report_templates for select to authenticated using (true);
create policy report_templates_insert on public.report_templates for insert to authenticated
    with check (public.is_admin() and is_active = false and created_by = auth.uid());
create policy report_templates_delete on public.report_templates for delete to authenticated
    using (public.is_admin() and is_active = false);

-- Make one version the active one (or pass NULL to go back to the built-in template).
create or replace function public.activate_report_template(template_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
    if not public.is_admin() then
        raise exception 'Only admins can change the report template' using errcode = '42501';
    end if;
    if template_id is not null and not exists (select 1 from public.report_templates where id = template_id) then
        raise exception 'Template % does not exist', template_id using errcode = 'P0002';
    end if;
    update public.report_templates set is_active = false where is_active and id is distinct from template_id;
    if template_id is not null then
        update public.report_templates set is_active = true where id = template_id;
    end if;
end $$;

revoke all on function public.activate_report_template(uuid) from public;
grant execute on function public.activate_report_template(uuid) to authenticated;

-- A report's template cannot be swapped after creation by non-admins.
create or replace function public.reports_template_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
    if auth.uid() is not null and not public.is_admin() then
        new.template_id := old.template_id;
    end if;
    return new;
end $$;

drop trigger if exists reports_template_guard on public.reports;
create trigger reports_template_guard before update on public.reports
    for each row execute function public.reports_template_guard();

commit;

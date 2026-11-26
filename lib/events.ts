import type { SupabaseClient } from '@supabase/supabase-js';
import { allFields, type ReportTemplate, type ReportValues } from './template';

/** An event on the calendar, with the organizer's name and (when visible) the report status. */
export interface CalendarEvent {
    id: string;
    title: string;
    event_date: string; // YYYY-MM-DD
    start_time: string | null; // HH:MM[:SS]
    end_time: string | null;
    /** Null while the organizer (known only by email) has not signed up. */
    organizer_id: string | null;
    organizer_email: string | null;
    organizer_name: string | null;
    report_id: string | null;
    nfa_ref: string | null;
    nfa_name: string | null;
    organizer: { full_name: string | null; email: string | null } | null;
    report: { status: string } | null;
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Local date as YYYY-MM-DD (no time-zone shift). */
export function toISODate(d: Date): string {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
}

/** Parses YYYY-MM-DD as a local date. */
export function fromISODate(s: string): Date {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
    return Math.round((fromISODate(to).getTime() - fromISODate(from).getTime()) / 86_400_000);
}

/** The 42 days (6 weeks, Sunday first) shown for a month. */
export function monthGrid(year: number, month: number): Date[] {
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

/** "10:00" from "10:00:00"; empty for null. */
export const shortTime = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');

export function timeRangeLabel(e: Pick<CalendarEvent, 'start_time' | 'end_time'>): string {
    const s = shortTime(e.start_time);
    const end = shortTime(e.end_time);
    return s && end ? `${s} – ${end}` : s || end || 'All day';
}

export const longDate = (iso: string) =>
    new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(fromISODate(iso));
export const shortDate = (iso: string) =>
    new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }).format(fromISODate(iso));

/** The field that holds the report title (same rule as admin delegation). */
export function titleFieldId(template: ReportTemplate): string {
    return template.titleFieldId ?? allFields(template).find((f) => f.type === 'text')?.id ?? 'activityTitle';
}

/** Where the NFA (Notice for Approval) goes in the report, if the format has such an upload. */
export function nfaFieldId(template: ReportTemplate): string | null {
    const uploads = allFields(template).filter((f) => f.type === 'attachments');
    return (uploads.find((f) => f.id === 'approvalFiles')
        ?? uploads.find((f) => /approval|nfa/i.test(f.label)))?.id ?? null;
}

/** The organizer's report, prefilled with what is known when the event is scheduled. */
export function prefillEventReport(template: ReportTemplate, e: { title: string; date: string; start?: string; end?: string }): ReportValues {
    const data: ReportValues = { [titleFieldId(template)]: e.title.trim() };
    const fields = allFields(template);
    const dates = fields.find((f) => f.type === 'dateRange');
    if (dates) {
        data[dates.id] = e.date;
        data[dates.endId ?? `${dates.id}End`] = e.date;
    }
    const times = fields.find((f) => f.type === 'timeRange');
    if (times && e.start) {
        data[times.id] = e.start;
        if (e.end) data[times.endId ?? `${times.id}End`] = e.end;
    }
    return data;
}

const EVENT_COLUMNS = 'id, title, event_date, start_time, end_time, organizer_id, organizer_email, organizer_name, report_id, nfa_ref, nfa_name, '
    + 'organizer:profiles!events_organizer_id_fkey(full_name, email), report:reports!events_report_id_fkey(status)';

type Joined<T> = T | T[] | null;
const one = <T,>(v: Joined<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v);

/** Events between two dates (inclusive). */
export async function loadEvents(supabase: SupabaseClient, from: string, to: string): Promise<CalendarEvent[]> {
    const { data, error } = await supabase.from('events').select(EVENT_COLUMNS)
        .gte('event_date', from).lte('event_date', to)
        .order('event_date').order('start_time', { nullsFirst: true });
    if (error) throw error;
    return ((data ?? []) as unknown as (Omit<CalendarEvent, 'organizer' | 'report'> & {
        organizer: Joined<CalendarEvent['organizer']>; report: Joined<CalendarEvent['report']>;
    })[]).map((e) => ({ ...e, organizer: one(e.organizer), report: one(e.report) }));
}

/** Tells other parts of the page (e.g. the checklist) that events changed. */
export const EVENTS_CHANGED = 'deptdocs:events-changed';
export const announceEventsChanged = () => window.dispatchEvent(new Event(EVENTS_CHANGED));

/** Name to show for an event's organizer. */
export const organizerLabel = (e: Pick<CalendarEvent, 'organizer' | 'organizer_name' | 'organizer_email'>) =>
    e.organizer?.full_name || e.organizer?.email || e.organizer_name || e.organizer_email || 'Organizer';

export const isValidEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim());

export interface OrganizerOption {
    id: string;
    full_name: string | null;
    email: string | null;
}

export type OrganizerChoice =
    | { kind: 'empty' }
    | { kind: 'member'; person: OrganizerOption }
    | { kind: 'email'; email: string }
    | { kind: 'invalid' };

/**
 * What the admin typed in the organizer box: a DeptDocs member (matched by email, or by exact
 * name when only one person has it), another email address, or nothing usable yet.
 */
export function resolveOrganizer(typed: string, people: OrganizerOption[]): OrganizerChoice {
    const text = typed.trim();
    if (!text) return { kind: 'empty' };
    const lower = text.toLowerCase();
    const byEmail = people.find((p) => p.email?.toLowerCase() === lower);
    if (byEmail) return { kind: 'member', person: byEmail };
    const byName = people.filter((p) => p.full_name?.trim().toLowerCase() === lower);
    if (byName.length === 1) return { kind: 'member', person: byName[0] };
    return isValidEmail(text) ? { kind: 'email', email: lower } : { kind: 'invalid' };
}

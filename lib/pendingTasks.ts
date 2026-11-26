import type { SupabaseClient } from '@supabase/supabase-js';
import { daysBetween, shortDate, shortTime, toISODate } from './events';

/** A report as the checklist needs it. */
export interface TaskReport {
    id: string;
    title: string | null;
    status: string;
    owner_id: string;
    admin_feedback: string | null;
    updated_at: string;
    /** Who submitted it (admin review list only). */
    ownerName?: string | null;
}

export interface TaskInvitation {
    id: string;
    report_title: string | null;
    owner_name: string | null;
}

/** An event the user organizes, linked to its report. */
export interface TaskEvent {
    id: string;
    title: string;
    event_date: string; // YYYY-MM-DD
    start_time: string | null;
    report_id: string | null;
}

export type ChecklistKind = 'review' | 'revise' | 'events' | 'drafts' | 'invites' | 'waiting';

export interface ChecklistEntry {
    id: string;
    title: string;
    detail?: string;
    href: string;
    actionLabel: string;
}

export interface ChecklistGroup {
    kind: ChecklistKind;
    label: string;
    /** Shown when there is nothing to do in this group. */
    doneLabel: string;
    /** Informational groups (e.g. waiting for approval) are not counted as to-dos. */
    isTodo: boolean;
    entries: ChecklistEntry[];
}

export interface PendingTasksInput {
    isAdmin: boolean;
    /** Drafts the user can submit: their own, plus reports they co-edit. */
    drafts: TaskReport[];
    /** The user's own reports that were submitted and are waiting for an admin. */
    submitted: TaskReport[];
    /** Admins only: every report waiting for approval. */
    toReview: TaskReport[];
    invitations: TaskInvitation[];
    /** Events the user organizes (their reports are listed under "Event reports to prepare"). */
    events?: TaskEvent[];
}

/** "in 5 days", "today", "tomorrow", "2 days ago". */
export function relativeDay(days: number): string {
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days === -1) return 'yesterday';
    return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

const untitled = (t: string | null | undefined) => (t && t.trim()) || 'Untitled report';
const shorten = (text: string, max = 90) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const byNewest = (a: TaskReport, b: TaskReport) => b.updated_at.localeCompare(a.updated_at);
const byOldest = (a: TaskReport, b: TaskReport) => a.updated_at.localeCompare(b.updated_at);

/** Sorts the user's open work into checklist groups (admins get the review queue first). */
export function buildChecklist(input: PendingTasksInput, today: string = toISODate(new Date())): ChecklistGroup[] {
    const groups: ChecklistGroup[] = [];

    if (input.isAdmin) {
        groups.push({
            kind: 'review', label: 'Reports to verify & approve', doneLabel: 'No reports waiting for approval', isTodo: true,
            // Oldest first: they have waited longest.
            entries: [...input.toReview].sort(byOldest).map((r) => ({
                id: r.id, title: untitled(r.title),
                detail: r.ownerName ? `Submitted by ${r.ownerName}` : undefined,
                href: `/admin?review=${encodeURIComponent(r.id)}`, actionLabel: 'Review',
            })),
        });
    }

    const eventByReport = new Map((input.events ?? []).filter((e) => e.report_id).map((e) => [e.report_id!, e]));
    const returned = input.drafts.filter((r) => r.admin_feedback && r.admin_feedback.trim());
    const notReturned = input.drafts.filter((r) => !(r.admin_feedback && r.admin_feedback.trim()));
    const eventDrafts = notReturned.filter((r) => eventByReport.has(r.id));
    const inProgress = notReturned.filter((r) => !eventByReport.has(r.id));

    groups.push({
        kind: 'revise', label: 'Sent back for changes', doneLabel: 'Nothing sent back for changes', isTodo: true,
        entries: [...returned].sort(byNewest).map((r) => ({
            id: r.id, title: untitled(r.title), detail: `Admin's note: ${shorten(r.admin_feedback!.trim())}`,
            href: `/home/new?id=${encodeURIComponent(r.id)}`, actionLabel: 'Fix',
        })),
    });
    groups.push({
        kind: 'events', label: 'Event reports to prepare', doneLabel: 'No event reports to prepare', isTodo: true,
        // Soonest (or most overdue) event first.
        entries: eventDrafts
            .map((r) => ({ r, e: eventByReport.get(r.id)! }))
            .sort((a, b) => a.e.event_date.localeCompare(b.e.event_date))
            .map(({ r, e }) => {
                const days = daysBetween(today, e.event_date);
                const time = shortTime(e.start_time);
                return {
                    id: r.id, title: untitled(r.title || e.title),
                    detail: `Event ${shortDate(e.event_date)}${time ? `, ${time}` : ''} · ${relativeDay(days)}${days < 0 ? ' (report pending)' : ''}`,
                    href: `/home/new?id=${encodeURIComponent(r.id)}`, actionLabel: 'Prepare',
                };
            }),
    });
    groups.push({
        kind: 'drafts', label: 'Drafts to finish & submit', doneLabel: 'No unfinished drafts', isTodo: true,
        entries: [...inProgress].sort(byNewest).map((r) => ({
            id: r.id, title: untitled(r.title), href: `/home/new?id=${encodeURIComponent(r.id)}`, actionLabel: 'Continue',
        })),
    });
    groups.push({
        kind: 'invites', label: 'Invitations waiting for your reply', doneLabel: 'No pending invitations', isTodo: true,
        entries: input.invitations.map((inv) => ({
            id: inv.id, title: untitled(inv.report_title),
            detail: inv.owner_name ? `From ${inv.owner_name}` : undefined,
            href: '/settings?tab=Requests', actionLabel: 'Respond',
        })),
    });
    groups.push({
        kind: 'waiting', label: 'Submitted, waiting for approval', doneLabel: 'Nothing waiting for approval', isTodo: false,
        entries: [...input.submitted].sort(byNewest).map((r) => ({
            id: r.id, title: untitled(r.title), href: `/home/new?id=${encodeURIComponent(r.id)}`, actionLabel: 'View',
        })),
    });

    return groups;
}

/** Number of open to-dos (informational groups excluded). */
export const todoCount = (groups: ChecklistGroup[]) =>
    groups.filter((g) => g.isTodo).reduce((n, g) => n + g.entries.length, 0);

const REPORT_COLUMNS = 'id, title, status, owner_id, admin_feedback, updated_at';

/**
 * Loads everything the checklist needs for the signed-in user. Each part fails on its own
 * (e.g. an older database without my_pending_invitations), so one error never hides the rest.
 */
export async function loadPendingTasks(supabase: SupabaseClient, userId: string, isAdmin: boolean): Promise<PendingTasksInput> {
    const [own, editing, invites, review, organizing] = await Promise.all([
        supabase.from('reports').select(REPORT_COLUMNS).eq('owner_id', userId).in('status', ['draft', 'completed']),
        supabase.from('collaborators').select('report_id').eq('user_id', userId).eq('status', 'accepted').eq('role', 'Editor'),
        supabase.rpc('my_pending_invitations'),
        isAdmin
            ? supabase.from('reports').select(`${REPORT_COLUMNS}, profiles!reports_owner_id_fkey(full_name)`).eq('status', 'completed')
            : Promise.resolve({ data: [], error: null }),
        // Older databases have no events table; that only empties this group.
        supabase.from('events').select('id, title, event_date, start_time, report_id').eq('organizer_id', userId),
    ]);

    const ownReports = (own.data ?? []) as TaskReport[];
    let coEdited: TaskReport[] = [];
    const editIds = ((editing.data ?? []) as { report_id: string }[]).map((c) => c.report_id);
    if (editIds.length > 0) {
        const { data } = await supabase.from('reports').select(REPORT_COLUMNS).in('id', editIds).eq('status', 'draft');
        coEdited = (data ?? []) as TaskReport[];
    }

    const drafts = [...ownReports.filter((r) => r.status === 'draft'), ...coEdited.filter((r) => r.owner_id !== userId)];
    type Owner = { full_name: string | null };
    const toReview = ((review.data ?? []) as unknown as (TaskReport & { profiles?: Owner | Owner[] | null })[])
        .map(({ profiles, ...r }) => ({ ...r, ownerName: (Array.isArray(profiles) ? profiles[0] : profiles)?.full_name ?? null }));

    return {
        isAdmin,
        drafts,
        submitted: ownReports.filter((r) => r.status === 'completed'),
        toReview,
        invitations: invites.error ? [] : ((invites.data ?? []) as TaskInvitation[]),
        events: organizing.error ? [] : ((organizing.data ?? []) as TaskEvent[]),
    };
}

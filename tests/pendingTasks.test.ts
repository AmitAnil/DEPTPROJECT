import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildChecklist, loadPendingTasks, relativeDay, todoCount, type TaskReport } from '@/lib/pendingTasks';

const report = (id: string, extra: Partial<TaskReport> = {}): TaskReport => ({
    id, title: `Report ${id}`, status: 'draft', owner_id: 'me', admin_feedback: null, updated_at: '2026-11-01T10:00:00Z', ...extra,
});

describe('buildChecklist', () => {
    it('puts the approval queue first for admins, oldest first, linking to the review', () => {
        const groups = buildChecklist({
            isAdmin: true, drafts: [], submitted: [], invitations: [],
            toReview: [
                report('new', { status: 'completed', updated_at: '2026-11-20T10:00:00Z', ownerName: 'Asha' }),
                report('old', { status: 'completed', updated_at: '2026-11-02T10:00:00Z', ownerName: null }),
            ],
        });
        expect(groups[0].kind).toBe('review');
        expect(groups[0].entries.map((e) => e.id)).toEqual(['old', 'new']);
        expect(groups[0].entries[0]).toMatchObject({ href: '/admin?review=old', actionLabel: 'Review', detail: undefined });
        expect(groups[0].entries[1].detail).toBe('Submitted by Asha');
    });

    it('does not show the approval queue to faculty', () => {
        const groups = buildChecklist({ isAdmin: false, drafts: [], submitted: [], toReview: [], invitations: [] });
        expect(groups.map((g) => g.kind)).toEqual(['revise', 'events', 'drafts', 'invites', 'waiting']);
        expect(todoCount(groups)).toBe(0);
    });

    it('separates reports sent back for changes from ordinary drafts', () => {
        const groups = buildChecklist({
            isAdmin: false, submitted: [], toReview: [], invitations: [],
            drafts: [report('a'), report('b', { admin_feedback: 'Please add photos of the session.' }), report('c', { admin_feedback: '   ' })],
        });
        const revise = groups.find((g) => g.kind === 'revise')!;
        const drafts = groups.find((g) => g.kind === 'drafts')!;
        expect(revise.entries.map((e) => e.id)).toEqual(['b']);
        expect(revise.entries[0]).toMatchObject({ detail: "Admin's note: Please add photos of the session.", href: '/home/new?id=b', actionLabel: 'Fix' });
        expect(drafts.entries.map((e) => e.id).sort()).toEqual(['a', 'c']);
    });

    it('counts to-dos but not reports that are only waiting for approval', () => {
        const groups = buildChecklist({
            isAdmin: false, toReview: [],
            drafts: [report('d')],
            submitted: [report('s1', { status: 'completed' }), report('s2', { status: 'completed' })],
            invitations: [{ id: 'i1', report_title: 'Hackathon', owner_name: 'Ravi' }],
        });
        expect(todoCount(groups)).toBe(2);
        expect(groups.find((g) => g.kind === 'waiting')!.entries).toHaveLength(2);
        expect(groups.find((g) => g.kind === 'invites')!.entries[0]).toMatchObject({ title: 'Hackathon', detail: 'From Ravi', href: '/settings?tab=Requests' });
    });

    it('names untitled reports and shortens long admin notes', () => {
        const groups = buildChecklist({
            isAdmin: false, submitted: [], toReview: [], invitations: [],
            drafts: [report('x', { title: '  ', admin_feedback: 'a'.repeat(200) })],
        });
        const entry = groups.find((g) => g.kind === 'revise')!.entries[0];
        expect(entry.title).toBe('Untitled report');
        expect(entry.detail!.length).toBeLessThan(110);
        expect(entry.detail!.endsWith('…')).toBe(true);
    });
});

/** A tiny stand-in for the Supabase client that answers by table name. */
function fakeClient(tables: Record<string, unknown[]>, rpc: { data: unknown; error: unknown }): SupabaseClient {
    const query = (rows: unknown[]) => {
        let result = rows;
        const chain = {
            select: () => chain,
            eq: (col: string, val: unknown) => { result = result.filter((r) => (r as Record<string, unknown>)[col] === val); return chain; },
            in: (col: string, vals: unknown[]) => { result = result.filter((r) => vals.includes((r as Record<string, unknown>)[col])); return chain; },
            then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: result, error: null }),
        };
        return chain;
    };
    return { from: (t: string) => query(tables[t] ?? []), rpc: async () => rpc } as unknown as SupabaseClient;
}

describe('loadPendingTasks', () => {
    const reports = [
        report('mine-draft'),
        report('mine-sent', { status: 'completed' }),
        report('mine-approved', { status: 'approved' }),
        report('shared-draft', { owner_id: 'colleague' }),
        report('shared-sent', { owner_id: 'colleague', status: 'completed', profiles: { full_name: 'Colleague' } } as Partial<TaskReport>),
    ];
    const collaborators = [
        { report_id: 'shared-draft', user_id: 'me', status: 'accepted', role: 'Editor' },
        { report_id: 'shared-sent', user_id: 'me', status: 'accepted', role: 'Editor' },
    ];

    it('collects own and co-edited drafts, own submitted reports and invitations', async () => {
        const input = await loadPendingTasks(
            fakeClient({ reports, collaborators }, { data: [{ id: 'i1', report_title: 'T', owner_name: 'O' }], error: null }), 'me', false);
        expect(input.drafts.map((r) => r.id).sort()).toEqual(['mine-draft', 'shared-draft']);
        expect(input.submitted.map((r) => r.id)).toEqual(['mine-sent']);
        expect(input.toReview).toEqual([]);
        expect(input.invitations).toHaveLength(1);
    });

    it("gives admins every report waiting for approval with the submitter's name", async () => {
        const input = await loadPendingTasks(fakeClient({ reports, collaborators: [] }, { data: [], error: null }), 'me', true);
        expect(input.toReview.map((r) => [r.id, r.ownerName ?? null])).toEqual([['mine-sent', null], ['shared-sent', 'Colleague']]);
    });

    it('still works on a database without the invitations function', async () => {
        const input = await loadPendingTasks(fakeClient({ reports, collaborators: [] }, { data: null, error: { message: 'function not found' } }), 'me', false);
        expect(input.invitations).toEqual([]);
        expect(input.drafts.map((r) => r.id)).toEqual(['mine-draft']);
    });
});

describe('event reports in the checklist', () => {
    const base = { isAdmin: false, submitted: [], toReview: [], invitations: [] };

    it('lists event reports separately, soonest first, with days left or passed', () => {
        const groups = buildChecklist({
            ...base,
            drafts: [report('r-late'), report('r-soon'), report('r-plain')],
            events: [
                { id: 'e1', title: 'Hackathon', event_date: '2026-12-10', start_time: '10:00:00', report_id: 'r-late' },
                { id: 'e2', title: 'Guest talk', event_date: '2026-11-24', start_time: null, report_id: 'r-soon' },
            ],
        }, '2026-11-26');
        const events = groups.find((g) => g.kind === 'events')!;
        expect(events.entries.map((e) => e.id)).toEqual(['r-soon', 'r-late']);
        expect(events.entries[0].detail).toMatch(/2 days ago \(report pending\)$/);
        expect(events.entries[1].detail).toMatch(/, 10:00 · in 14 days$/);
        expect(events.entries[1]).toMatchObject({ href: '/home/new?id=r-late', actionLabel: 'Prepare' });
        // Not repeated as an ordinary draft.
        expect(groups.find((g) => g.kind === 'drafts')!.entries.map((e) => e.id)).toEqual(['r-plain']);
        expect(todoCount(groups)).toBe(3);
    });

    it('keeps an event report that was sent back under "Sent back for changes"', () => {
        const groups = buildChecklist({
            ...base,
            drafts: [report('r1', { admin_feedback: 'Add the brochure.' })],
            events: [{ id: 'e1', title: 'Expo', event_date: '2026-11-20', start_time: null, report_id: 'r1' }],
        }, '2026-11-26');
        expect(groups.find((g) => g.kind === 'revise')!.entries.map((e) => e.id)).toEqual(['r1']);
        expect(groups.find((g) => g.kind === 'events')!.entries).toEqual([]);
    });

    it('describes days in plain words', () => {
        expect([relativeDay(0), relativeDay(1), relativeDay(-1), relativeDay(5), relativeDay(-3)])
            .toEqual(['today', 'tomorrow', 'yesterday', 'in 5 days', '3 days ago']);
    });
});

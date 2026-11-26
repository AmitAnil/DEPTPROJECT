import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_TEMPLATE, parseTemplate } from '@/lib/template';
import { daysBetween, isValidEmail, monthGrid, nfaFieldId, organizerLabel, prefillEventReport, resolveOrganizer, timeRangeLabel, toISODate } from '@/lib/events';
import { localDateAndHour, runReminderSweep } from '@/lib/eventReminders';

vi.mock('@/lib/notificationDispatch', () => ({ dispatchNotificationEmails: vi.fn(async () => ({ sent: 0, failed: 0, skipped: 0 })) }));

describe('calendar dates', () => {
    it('shows 6 full weeks starting on a Sunday', () => {
        const days = monthGrid(2026, 10); // November 2026 starts on a Sunday
        expect(days).toHaveLength(42);
        expect(toISODate(days[0])).toBe('2026-11-01');
        expect(days.every((d, i) => d.getDay() === i % 7)).toBe(true);
        const dec = monthGrid(2026, 11); // December 2026 starts on a Tuesday
        expect(toISODate(dec[0])).toBe('2026-11-29');
    });

    it('counts days across month ends', () => {
        expect(daysBetween('2026-11-26', '2026-12-03')).toBe(7);
        expect(daysBetween('2026-12-03', '2026-11-26')).toBe(-7);
    });

    it('labels times', () => {
        expect(timeRangeLabel({ start_time: '10:00:00', end_time: '12:30:00' })).toBe('10:00 – 12:30');
        expect(timeRangeLabel({ start_time: '09:15', end_time: null })).toBe('09:15');
        expect(timeRangeLabel({ start_time: null, end_time: null })).toBe('All day');
    });
});

describe("the organizer's report", () => {
    it('is prefilled with the title, date and time of the event', () => {
        const data = prefillEventReport(DEFAULT_TEMPLATE, { title: '  AI Workshop ', date: '2026-12-10', start: '10:00', end: '12:00' });
        expect(data).toEqual({ activityTitle: 'AI Workshop', date: '2026-12-10', endDate: '2026-12-10', time: '10:00', endTime: '12:00' });
    });

    it('puts the NFA in the Notice for Approval upload', () => {
        expect(nfaFieldId(DEFAULT_TEMPLATE)).toBe('approvalFiles');
        const custom = parseTemplate({
            schemaVersion: 1, name: 'T', header: { lines: [], title: 'R' },
            sections: [{ id: 's', title: 'S', fields: [{ id: 'nfaDocs', label: 'Upload NFA', type: 'attachments' }] }],
        });
        expect(nfaFieldId(custom)).toBe('nfaDocs');
    });
});

describe('daily reminders', () => {
    it('uses the local date and hour of the reminder time zone', () => {
        // 20:00 UTC on 25 Nov is 01:30 on 26 Nov in India.
        expect(localDateAndHour(new Date('2026-11-25T20:00:00Z'), 'Asia/Kolkata')).toEqual({ date: '2026-11-26', hour: 1 });
    });

    const fakeAdmin = () => {
        const rpc = vi.fn(async () => ({ data: 2, error: null }));
        return { client: { rpc } as unknown as SupabaseClient, rpc };
    };

    it('waits until the reminder hour (9 AM by default) before queuing', async () => {
        const early = fakeAdmin();
        const r1 = await runReminderSweep(early.client, new Date('2026-11-26T02:00:00Z')); // 07:30 IST
        expect(r1).toMatchObject({ date: '2026-11-26', tooEarly: true, queued: 0 });
        expect(early.rpc).not.toHaveBeenCalled();

        const later = fakeAdmin();
        const r2 = await runReminderSweep(later.client, new Date('2026-11-26T04:00:00Z')); // 09:30 IST
        expect(r2).toMatchObject({ tooEarly: false, queued: 2 });
        expect(later.rpc).toHaveBeenCalledWith('queue_event_reminders', { p_today: '2026-11-26' });
    });

    it('can be run right away by an admin or a scheduler', async () => {
        const admin = fakeAdmin();
        const r = await runReminderSweep(admin.client, new Date('2026-11-26T00:30:00Z'), { ignoreHour: true });
        expect(r.queued).toBe(2);
    });
});

describe('organizer box (pick a person or type any email)', () => {
    const people = [
        { id: 'u1', full_name: 'Asha Rao', email: 'asha@christuniversity.in' },
        { id: 'u2', full_name: 'Ravi Kumar', email: 'ravi@christuniversity.in' },
        { id: 'u3', full_name: 'Ravi Kumar', email: 'ravi.k@christuniversity.in' },
    ];

    it('recognises a DeptDocs member by email, in any letter case', () => {
        expect(resolveOrganizer('  ASHA@christuniversity.in ', people)).toEqual({ kind: 'member', person: people[0] });
    });

    it('recognises a member by name only when the name is unique', () => {
        expect(resolveOrganizer('asha rao', people)).toMatchObject({ kind: 'member', person: { id: 'u1' } });
        expect(resolveOrganizer('Ravi Kumar', people)).toEqual({ kind: 'invalid' });
    });

    it('accepts any other valid email, stored in lower case', () => {
        expect(resolveOrganizer('Guest.Speaker@Example.com', people)).toEqual({ kind: 'email', email: 'guest.speaker@example.com' });
    });

    it('rejects text that is neither', () => {
        expect(resolveOrganizer('', people)).toEqual({ kind: 'empty' });
        expect(resolveOrganizer('guest@', people)).toEqual({ kind: 'invalid' });
        expect(isValidEmail('a@b')).toBe(false);
        expect(isValidEmail('a@b.co')).toBe(true);
    });

    it('shows the best available organizer name on the calendar', () => {
        expect(organizerLabel({ organizer: { full_name: 'Asha', email: 'a@x.in' }, organizer_name: null, organizer_email: null })).toBe('Asha');
        expect(organizerLabel({ organizer: null, organizer_name: 'Dr. Guest', organizer_email: 'g@x.com' })).toBe('Dr. Guest');
        expect(organizerLabel({ organizer: null, organizer_name: null, organizer_email: 'g@x.com' })).toBe('g@x.com');
    });
});

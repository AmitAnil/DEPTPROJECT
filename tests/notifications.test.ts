import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('nodemailer', () => {
    const sendMail = vi.fn(async (mail: { to: string }) => {
        if (mail.to === 'bounce@example.edu') throw new Error('mailbox unavailable');
        return { messageId: 'x' };
    });
    return { default: { createTransport: () => ({ sendMail }) }, __sendMail: sendMail };
});

import { notificationEmail } from '@/lib/email';
import { dispatchNotificationEmails } from '@/lib/notificationDispatch';

function fakeAdmin(rows: Record<string, unknown>[], outbound: Record<string, unknown>[] = []) {
    const updates: { id: string; patch: Record<string, unknown>; table?: string }[] = [];
    const client = {
        rpc: vi.fn(async (name: string) => ({ data: name === 'claim_outbound_emails' ? outbound : rows, error: null })),
        from: (table: string) => ({
            update: (patch: Record<string, unknown>) => ({
                eq: async (_col: string, id: string) => { updates.push({ id, patch, table }); return { error: null }; },
            }),
        }),
    };
    return { client: client as never, updates };
}

const row = (over: Record<string, unknown>) => ({ id: '1', title: 'Report approved', message: 'Done', link: '/home/new?id=1', email: 'a@christuniversity.in', full_name: 'A', wants_email: true, ...over });

describe('notification emails', () => {
    afterEach(() => { delete process.env.SMTP_HOST; delete process.env.SMTP_FROM; delete process.env.SITE_URL; });

    it('escapes user content in HTML', () => {
        const mail = notificationEmail({ to: 'x@y.z', title: '<b>Hi</b>', message: 'Feedback: <script>alert(1)</script>', url: 'https://app/home' });
        expect(mail.html).not.toContain('<script>');
        expect(mail.html).toContain('&lt;script&gt;');
        expect(mail.text).toContain('Open in DeptDocs: https://app/home');
        expect(mail.subject).toBe('DeptDocs: <b>Hi</b>');
    });

    it('skips everything when SMTP is not configured', async () => {
        const { client, updates } = fakeAdmin([row({})]);
        const result = await dispatchNotificationEmails(client);
        expect(result).toMatchObject({ sent: 0, skipped: 1, emailEnabled: false });
        expect(updates[0].patch.email_status).toBe('skipped');
    });

    it('sends, respects opt-out and records failures', async () => {
        process.env.SMTP_HOST = 'smtp.example.edu';
        process.env.SMTP_FROM = 'DeptDocs <noreply@example.edu>';
        process.env.SITE_URL = 'https://app';
        const { client, updates } = fakeAdmin([
            row({ id: 'ok' }),
            row({ id: 'optout', wants_email: false }),
            row({ id: 'bad', email: 'bounce@example.edu' }),
            row({ id: 'phish', link: 'https://evil.example' }),
        ]);
        const result = await dispatchNotificationEmails(client);
        expect(result).toMatchObject({ sent: 2, skipped: 1, failed: 1 });
        const status = Object.fromEntries(updates.map((u) => [u.id, u.patch.email_status]));
        expect(status).toEqual({ ok: 'sent', optout: 'skipped', bad: 'failed', phish: 'sent' });
        const nodemailer = (await import('nodemailer')) as unknown as { __sendMail: { mock: { calls: [{ text: string }][] } } };
        const phishMail = nodemailer.__sendMail.mock.calls.map((c) => c[0]).find((m) => m.text.includes('Open in DeptDocs: https://app\n') || m.text.endsWith('https://app'));
        expect(nodemailer.__sendMail.mock.calls.some((c) => c[0].text.includes('evil.example'))).toBe(false);
        expect(phishMail).toBeDefined();
    });

    it('never builds links from request data: no SITE_URL means no link', async () => {
        process.env.SMTP_HOST = 'smtp.example.edu';
        process.env.SMTP_FROM = 'DeptDocs <noreply@example.edu>';
        const { client } = fakeAdmin([row({ id: 'nolink' })]);
        await dispatchNotificationEmails(client);
        const nodemailer = (await import('nodemailer')) as unknown as { __sendMail: { mock: { calls: [{ text: string; html: string }][] } } };
        const last = nodemailer.__sendMail.mock.calls.at(-1)![0];
        expect(last.text).not.toContain('Open in DeptDocs:');
        expect(last.html).not.toContain('href=');
    });

    it('also emails organizers who have no account yet, with a link to sign up', async () => {
        process.env.SMTP_HOST = 'smtp.example.edu';
        process.env.SMTP_FROM = 'DeptDocs <christadse@gmail.com>';
        process.env.SITE_URL = 'https://deptdocs.example.edu';
        const nodemailer = await import('nodemailer') as unknown as { __sendMail: ReturnType<typeof vi.fn> };
        nodemailer.__sendMail.mockClear();
        const { client, updates } = fakeAdmin([], [
            { id: 'o1', to_email: 'guest@example.com', to_name: 'Dr. Guest', title: 'Event scheduled: "Talk"', message: 'Please sign up', link: '/signup' },
            { id: 'o2', to_email: 'bounce@example.edu', to_name: null, title: 'Reminder', message: 'x', link: null },
        ]);
        const result = await dispatchNotificationEmails(client);
        expect(result).toMatchObject({ sent: 1, failed: 1 });
        const mail = nodemailer.__sendMail.mock.calls[0][0] as { to: string; text: string };
        expect(mail.to).toBe('guest@example.com');
        expect(mail.text).toContain('https://deptdocs.example.edu/signup');
        expect(updates.find((u) => u.id === 'o1')).toMatchObject({ table: 'outbound_emails', patch: { email_status: 'sent' } });
        expect(updates.find((u) => u.id === 'o2')).toMatchObject({ table: 'outbound_emails', patch: { email_status: 'failed' } });
    });

    it('marks queued emails to addresses without an account as skipped when SMTP is off', async () => {
        const { client, updates } = fakeAdmin([], [{ id: 'o1', to_email: 'guest@example.com', to_name: null, title: 'T', message: null, link: null }]);
        const result = await dispatchNotificationEmails(client);
        expect(result).toMatchObject({ skipped: 1, sent: 0 });
        expect(updates[0]).toMatchObject({ table: 'outbound_emails', patch: { email_status: 'skipped' } });
    });
});

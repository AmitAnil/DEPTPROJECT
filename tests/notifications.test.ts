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

function fakeAdmin(rows: Record<string, unknown>[]) {
    const updates: { id: string; patch: Record<string, unknown> }[] = [];
    const client = {
        rpc: vi.fn(async () => ({ data: rows, error: null })),
        from: () => ({
            update: (patch: Record<string, unknown>) => ({
                eq: async (_col: string, id: string) => { updates.push({ id, patch }); return { error: null }; },
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
});

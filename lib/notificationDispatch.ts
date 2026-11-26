// SERVER ONLY: sends queued notification emails (rows with email_status = 'pending').
// Notifications themselves are created by database triggers; see
// supabase/migrations/*_notifications_and_accounts.sql.
import type { SupabaseClient } from '@supabase/supabase-js';
import { isEmailConfigured, notificationEmail, sendEmail } from './email';
import { isSafeInternalLink } from './redirect';

interface ClaimedRow {
    id: string;
    title: string;
    message: string | null;
    link: string | null;
    email: string | null;
    full_name: string | null;
    wants_email: boolean;
}

export interface DispatchResult {
    sent: number;
    skipped: number;
    failed: number;
    emailEnabled: boolean;
}

/** Public address used in email links. Never derived from request headers (they can be forged). */
function siteUrl(): string | null {
    const v = process.env.SITE_URL?.trim().replace(/\/+$/, '');
    if (!v) return null;
    try {
        const u = new URL(v);
        return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
    } catch {
        return null;
    }
}

interface OutboundRow {
    id: string;
    to_email: string;
    to_name: string | null;
    title: string;
    message: string | null;
    link: string | null;
}

/** Link for the email button: an internal path on SITE_URL, or the site itself. */
const buttonUrl = (origin: string | null, link: string | null) =>
    origin ? (isSafeInternalLink(link) ? `${origin}${link}` : origin) : null;

/**
 * Claims up to `limit` queued notifications and emails them, then does the same for emails to
 * addresses without a DeptDocs account (event organizers who have not signed up). Safe to run concurrently.
 */
export async function dispatchNotificationEmails(admin: SupabaseClient, limit = 25): Promise<DispatchResult> {
    const result = await dispatchUserEmails(admin, limit);
    await dispatchOutboundEmails(admin, limit, result);
    return result;
}

async function dispatchUserEmails(admin: SupabaseClient, limit: number): Promise<DispatchResult> {
    const origin = siteUrl();
    const result: DispatchResult = { sent: 0, skipped: 0, failed: 0, emailEnabled: isEmailConfigured() };

    const { data, error } = await admin.rpc('claim_notification_emails', { max_count: limit });
    if (error) {
        console.error('Could not claim notification emails:', error.message);
        return result;
    }

    for (const row of (data ?? []) as ClaimedRow[]) {
        const mark = (patch: Record<string, unknown>) => admin.from('notifications').update(patch).eq('id', row.id);

        if (!result.emailEnabled || !row.wants_email || !row.email) {
            result.skipped += 1;
            await mark({ email_status: 'skipped', email_error: !result.emailEnabled ? 'SMTP not configured' : null });
            continue;
        }
        try {
            // Without SITE_URL the email has no button; the notification is still in the app.
            const url = buttonUrl(origin, row.link);
            await sendEmail(notificationEmail({ to: row.email, name: row.full_name, title: row.title, message: row.message, url }));
            result.sent += 1;
            await mark({ email_status: 'sent', emailed_at: new Date().toISOString(), email_error: null });
        } catch (err) {
            result.failed += 1;
            const message = err instanceof Error ? err.message : String(err);
            console.error(`Email to ${row.email} failed:`, message);
            await mark({ email_status: 'failed', email_error: message.slice(0, 500) });
        }
    }
    return result;
}

/** Emails queued for addresses without an account (public.outbound_emails). Adds to `result`. */
async function dispatchOutboundEmails(admin: SupabaseClient, limit: number, result: DispatchResult): Promise<void> {
    const { data, error } = await admin.rpc('claim_outbound_emails', { max_count: limit });
    if (error) {
        // Databases without the event-organizer migration have no such queue; nothing to send.
        if (!/claim_outbound_emails/.test(error.message)) console.error('Could not claim outbound emails:', error.message);
        return;
    }
    const origin = siteUrl();
    for (const row of (data ?? []) as OutboundRow[]) {
        const mark = (patch: Record<string, unknown>) => admin.from('outbound_emails').update(patch).eq('id', row.id);
        if (!result.emailEnabled) {
            result.skipped += 1;
            await mark({ email_status: 'skipped', email_error: 'SMTP not configured' });
            continue;
        }
        try {
            await sendEmail(notificationEmail({ to: row.to_email, name: row.to_name, title: row.title, message: row.message, url: buttonUrl(origin, row.link) }));
            result.sent += 1;
            await mark({ email_status: 'sent', emailed_at: new Date().toISOString(), email_error: null });
        } catch (err) {
            result.failed += 1;
            const message = err instanceof Error ? err.message : String(err);
            console.error(`Email to ${row.to_email} failed:`, message);
            await mark({ email_status: 'failed', email_error: message.slice(0, 500) });
        }
    }
}

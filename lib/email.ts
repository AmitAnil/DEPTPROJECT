// SERVER ONLY: outgoing email over SMTP (Gmail / Google Workspace, Microsoft 365,
// the university mail server, ...). Email is optional: without SMTP_HOST the app only
// shows in-app notifications.
import nodemailer, { type Transporter } from 'nodemailer';

export interface OutgoingEmail {
    to: string;
    subject: string;
    text: string;
    html: string;
}

let transporter: Transporter | null = null;

export function isEmailConfigured(): boolean {
    return !!process.env.SMTP_HOST && !!process.env.SMTP_FROM;
}

function getTransporter(): Transporter {
    if (!transporter) {
        const port = Number(process.env.SMTP_PORT || 587);
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port,
            // 465 = implicit TLS; 587/25 upgrade with STARTTLS.
            secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
            auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
        });
    }
    return transporter;
}

export async function sendEmail(mail: OutgoingEmail): Promise<void> {
    await getTransporter().sendMail({ from: process.env.SMTP_FROM, ...mail });
}

const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Plain, client-safe email for a notification. */
export function notificationEmail(opts: { to: string; name?: string | null; title: string; message?: string | null; url?: string | null }): OutgoingEmail {
    const greeting = opts.name ? `Dear ${opts.name},` : 'Hello,';
    const message = opts.message ?? '';
    const text = [greeting, '', message, '', opts.url ? `Open in DeptDocs: ${opts.url}` : '', '', 'You can turn these emails off in DeptDocs: Settings > Settings > Email notifications.']
        .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
        .join('\n');
    const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;background:#f4f7fe;padding:24px">
<table role="presentation" width="100%" style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:24px">
<tr><td>
<p style="margin:0 0 16px;font-size:13px;color:#6b7280">DeptDocs</p>
<h2 style="margin:0 0 12px;color:#112a53;font-size:18px">${escapeHtml(opts.title)}</h2>
<p style="margin:0 0 8px">${escapeHtml(greeting)}</p>
<p style="margin:0 0 20px;white-space:pre-wrap">${escapeHtml(message)}</p>
${opts.url ? `<p style="margin:0 0 24px"><a href="${escapeHtml(opts.url)}" style="background:#3168d8;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">Open in DeptDocs</a></p>` : ''}
<p style="margin:0;font-size:12px;color:#9ca3af">You can turn these emails off in DeptDocs under Settings &rarr; Settings &rarr; Email notifications.</p>
</td></tr></table></body></html>`;
    return { to: opts.to, subject: `DeptDocs: ${opts.title}`, text, html };
}

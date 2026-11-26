// SERVER ONLY: queues the daily event-report reminders and sends the emails.
import type { SupabaseClient } from '@supabase/supabase-js';
import { dispatchNotificationEmails, type DispatchResult } from './notificationDispatch';

/** Time zone that decides what "today" is for reminders. */
export const reminderTimeZone = () => process.env.REMINDER_TIMEZONE || 'Asia/Kolkata';
/** Reminders for a day go out at the first check from this hour (0–23, local time). */
export const reminderHour = () => {
    const h = Number(process.env.REMINDER_HOUR ?? 9);
    return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 9;
};

/** The local calendar date (YYYY-MM-DD) and hour in a time zone. */
export function localDateAndHour(now: Date, timeZone: string): { date: string; hour: number } {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
            .formatToParts(now).map((p) => [p.type, p.value]),
    );
    return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

export interface SweepResult {
    date: string;
    /** Reminders queued now (0 before the reminder hour or when everyone was reminded today). */
    queued: number;
    tooEarly: boolean;
    emails?: DispatchResult;
}

/**
 * Queues today's reminders (at most one per event per day, handled by the database) and sends
 * every queued email. Safe to run as often as you like.
 */
export async function runReminderSweep(admin: SupabaseClient, now = new Date(), opts: { ignoreHour?: boolean } = {}): Promise<SweepResult> {
    const { date, hour } = localDateAndHour(now, reminderTimeZone());
    const tooEarly = !opts.ignoreHour && hour < reminderHour();
    let queued = 0;
    if (!tooEarly) {
        const { data, error } = await admin.rpc('queue_event_reminders', { p_today: date });
        if (error) throw new Error(`Could not queue event reminders: ${error.message}`);
        queued = typeof data === 'number' ? data : 0;
    }
    const emails = await dispatchNotificationEmails(admin);
    return { date, queued, tooEarly, emails };
}

// SERVER ONLY: runs the event-report reminders on a timer while the app is running.
import { createAdminClient } from '@/utils/supabase/admin';
import { runReminderSweep } from './eventReminders';

const CHECK_EVERY_MS = 30 * 60 * 1000;
const FIRST_CHECK_AFTER_MS = 20 * 1000;
const STARTED = Symbol.for('deptdocs.reminderScheduler');

/**
 * Starts the reminder timer once per server process. Every 30 minutes it queues today's
 * reminders (from REMINDER_HOUR, default 9 AM) and sends queued emails.
 * Turn it off with EVENT_REMINDERS=off, e.g. when an external cron calls /api/events/reminders.
 */
export function startReminderScheduler(): void {
    const g = globalThis as typeof globalThis & { [STARTED]?: boolean };
    if (g[STARTED]) return; // dev mode reloads modules; keep a single timer
    if (process.env.EVENT_REMINDERS === 'off') return;
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
        console.info('[reminders] Not started: Supabase keys are not set.');
        return;
    }
    g[STARTED] = true;

    let running = false;
    const check = async () => {
        if (running) return;
        running = true;
        try {
            const result = await runReminderSweep(createAdminClient());
            if (result.queued > 0) console.info(`[reminders] ${result.date}: queued ${result.queued} event reminder(s).`);
        } catch (error) {
            console.error('[reminders]', error instanceof Error ? error.message : error);
        } finally {
            running = false;
        }
    };
    setTimeout(check, FIRST_CHECK_AFTER_MS);
    setInterval(check, CHECK_EVERY_MS).unref?.();
}

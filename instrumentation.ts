// Runs once when the Next.js server starts.
export async function register() {
    // The reminder timer needs Node.js (not the Edge runtime).
    if (process.env.NEXT_RUNTIME !== 'nodejs') return;
    const { startReminderScheduler } = await import('./lib/reminderScheduler');
    startReminderScheduler();
}

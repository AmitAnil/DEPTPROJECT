/**
 * Asks the server to email any notifications the database just queued.
 * Fire-and-forget: in-app notifications work even if this fails.
 */
export function kickEmailDispatch(): void {
    // Give the database trigger a moment to commit before the server looks for new rows.
    setTimeout(() => {
        fetch('/api/notifications/dispatch', { method: 'POST' }).catch(() => undefined);
    }, 500);
}

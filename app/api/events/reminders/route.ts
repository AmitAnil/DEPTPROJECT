import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getAuthContext, unauthorized } from '@/lib/auth';
import { runReminderSweep } from '@/lib/eventReminders';
import { createAdminClient } from '@/utils/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function hasCronSecret(req: Request): boolean {
    const secret = process.env.CRON_SECRET;
    const header = req.headers.get('authorization') ?? '';
    if (!secret || !header.startsWith('Bearer ')) return false;
    const a = Buffer.from(header.slice(7));
    const b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Queues today's event-report reminders and sends queued emails. The app already does this every
 * 30 minutes while it runs; call this from an external scheduler (`Authorization: Bearer $CRON_SECRET`)
 * or as an admin to run it right away. Reminders are still at most one per event per day.
 */
export async function POST(req: Request) {
    if (!hasCronSecret(req)) {
        const ctx = await getAuthContext();
        if (!ctx?.isAdmin) return unauthorized();
    }
    try {
        return NextResponse.json(await runReminderSweep(createAdminClient(), new Date(), { ignoreHour: true }));
    } catch (error) {
        console.error('Event reminders failed:', error);
        return NextResponse.json({ error: 'Reminders failed.' }, { status: 500 });
    }
}

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getAuthContext, unauthorized } from '@/lib/auth';
import { dispatchNotificationEmails } from '@/lib/notificationDispatch';
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
 * Sends queued notification emails. The app calls this after actions that create
 * notifications; a scheduler can also call it with `Authorization: Bearer $CRON_SECRET`.
 * It only sends what the database queued, so any signed-in user may trigger it.
 */
export async function POST(req: Request) {
    if (!hasCronSecret(req) && !(await getAuthContext())) return unauthorized();
    try {
        const result = await dispatchNotificationEmails(createAdminClient());
        return NextResponse.json(result);
    } catch (error) {
        console.error('Notification dispatch failed:', error);
        return NextResponse.json({ error: 'Dispatch failed.' }, { status: 500 });
    }
}

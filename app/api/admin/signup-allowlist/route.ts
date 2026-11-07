import { NextResponse } from 'next/server';
import { forbidden, getAuthContext, unauthorized } from '@/lib/auth';
import { createAdminClient } from '@/utils/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// A domain ("christuniversity.in") or a full email address.
const ENTRY = /^(?:[^\s@]+@)?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

async function requireAdmin() {
    const ctx = await getAuthContext();
    if (!ctx) return { error: unauthorized() };
    if (!ctx.isAdmin) return { error: forbidden() };
    return { ctx };
}

/** Admin only: list who may sign up. */
export async function GET() {
    const { error } = await requireAdmin();
    if (error) return error;
    const { data, error: dbError } = await createAdminClient().from('signup_allowlist').select('entry, note, created_at').order('entry');
    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
    return NextResponse.json({ entries: data });
}

/** Admin only: body { entry, note? } */
export async function POST(req: Request) {
    const { ctx, error } = await requireAdmin();
    if (error) return error;
    const body = await req.json().catch(() => ({}));
    const entry = typeof body.entry === 'string' ? body.entry.trim().toLowerCase() : '';
    if (!ENTRY.test(entry)) return NextResponse.json({ error: 'Enter a domain (e.g. christuniversity.in) or a full email address.' }, { status: 400 });
    const note = typeof body.note === 'string' ? body.note.slice(0, 200) : null;
    const admin = createAdminClient();
    const { error: dbError } = await admin.from('signup_allowlist').upsert({ entry, note });
    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
    await admin.from('activity_logs').insert({ user_id: ctx.user.id, user_name: ctx.user.email, action_type: 'SIGNUP_ALLOWED', description: `allowed sign-ups for ${entry}` });
    return NextResponse.json({ success: true });
}

/** Admin only: ?entry=... */
export async function DELETE(req: Request) {
    const { ctx, error } = await requireAdmin();
    if (error) return error;
    const entry = new URL(req.url).searchParams.get('entry')?.trim().toLowerCase() ?? '';
    if (!entry) return NextResponse.json({ error: 'Missing entry.' }, { status: 400 });
    const admin = createAdminClient();
    const { error: dbError } = await admin.from('signup_allowlist').delete().eq('entry', entry);
    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
    await admin.from('activity_logs').insert({ user_id: ctx.user.id, user_name: ctx.user.email, action_type: 'SIGNUP_REMOVED', description: `removed sign-up rule ${entry}` });
    return NextResponse.json({ success: true });
}

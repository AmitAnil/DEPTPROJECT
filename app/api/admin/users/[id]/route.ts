import { NextResponse } from 'next/server';
import { forbidden, getAuthContext, unauthorized } from '@/lib/auth';
import { createAdminClient } from '@/utils/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Supabase Auth has no "permanent" ban; ~100 years is the documented approach.
const BAN_DURATION = '876000h';

/**
 * Admin only. Body: { role?: 'admin' | 'faculty', active?: boolean }
 * - role: promote/demote
 * - active=false: deactivates the account (profile flag + Supabase Auth ban, so they cannot sign in)
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    if (!ctx.isAdmin) return forbidden();

    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: 'Invalid user id.' }, { status: 400 });
    if (id === ctx.user.id) {
        return NextResponse.json({ error: 'You cannot change your own role or deactivate yourself. Ask another admin.' }, { status: 400 });
    }

    let body: { role?: unknown; active?: unknown };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }
    const role = body.role === 'admin' || body.role === 'faculty' ? body.role : undefined;
    const active = typeof body.active === 'boolean' ? body.active : undefined;
    if (role === undefined && active === undefined) {
        return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: target, error: targetError } = await admin.from('profiles').select('id, full_name, email, role, is_active').eq('id', id).maybeSingle();
    if (targetError || !target) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

    // Never leave the department without an active admin.
    if ((role === 'faculty' || active === false) && target.role === 'admin' && target.is_active) {
        const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('is_active', true);
        if ((count ?? 0) <= 1) return NextResponse.json({ error: 'This is the last active admin.' }, { status: 400 });
    }

    if (active !== undefined) {
        const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: active ? 'none' : BAN_DURATION });
        if (error) return NextResponse.json({ error: `Could not update the login: ${error.message}` }, { status: 500 });
    }
    const patch: Record<string, unknown> = {};
    if (role !== undefined) patch.role = role;
    if (active !== undefined) patch.is_active = active;
    const { error: updateError } = await admin.from('profiles').update(patch).eq('id', id);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    const who = target.full_name || target.email || id;
    const what = [
        role === 'admin' ? 'made admin' : role === 'faculty' ? 'removed admin rights from' : null,
        active === false ? 'deactivated' : active === true ? 'reactivated' : null,
    ].filter(Boolean).join(' and ');
    await admin.from('activity_logs').insert({ user_id: ctx.user.id, user_name: ctx.user.email, action_type: 'USER_UPDATED', description: `${what} ${who}`, target_id: id });

    return NextResponse.json({ success: true });
}

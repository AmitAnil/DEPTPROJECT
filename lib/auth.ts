// SERVER ONLY helpers for API routes.
import { NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createClient } from '@/utils/supabase/server';

export interface AuthContext {
    supabase: SupabaseClient;
    user: User;
    isAdmin: boolean;
}

/** Returns the signed-in user (verified with Supabase Auth) or null. */
export async function getAuthContext(): Promise<AuthContext | null> {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;

    const { data: profile } = await supabase.from('profiles').select('role, is_active').eq('id', user.id).maybeSingle();
    // Deactivated accounts can still hold a valid session token until it expires (the Auth ban only
    // stops new sign-ins). Treat them as signed out, and never as admins (same rule as public.is_admin()).
    if (profile && profile.is_active === false) return null;
    return { supabase, user, isAdmin: profile?.role === 'admin' && profile?.is_active !== false };
}

export const unauthorized = () => NextResponse.json({ error: 'You must be signed in.' }, { status: 401 });
export const forbidden = () => NextResponse.json({ error: 'You do not have permission to do this.' }, { status: 403 });

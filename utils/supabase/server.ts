import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getPublicSupabaseConfig } from './config';

/** Supabase client acting as the signed-in user (row level security applies). */
export async function createClient() {
    const cookieStore = await cookies();
    const { url, anonKey } = getPublicSupabaseConfig();

    return createServerClient(url, anonKey, {
        cookies: {
            getAll() {
                return cookieStore.getAll();
            },
            setAll(cookiesToSet) {
                try {
                    cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
                } catch {
                    // Called from a Server Component: cookies are refreshed by proxy.ts instead.
                }
            },
        },
    });
}

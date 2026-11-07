import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

export function createClient(): SupabaseClient {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
        const message =
            'Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set at build time (see .env.example).';
        if (typeof window !== 'undefined') {
            // In the browser this is always a deployment mistake - fail loudly.
            throw new Error(message);
        }
        // During `next build` client components are pre-rendered on the server, where the
        // client is never actually used. Return a stub that explains itself if it is.
        return new Proxy({} as SupabaseClient, {
            get() {
                throw new Error(message);
            },
        });
    }

    return createBrowserClient(supabaseUrl, supabaseKey);
}

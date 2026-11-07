// SERVER ONLY. Never import this file from a client component: the service role key
// bypasses every row level security policy.
import { createClient } from '@supabase/supabase-js';
import { SIGNED_URL_TTL_SECONDS, type StorageSigner } from '@/lib/storage';
import { getPublicSupabaseConfig } from './config';

export function createAdminClient() {
    if (typeof window !== 'undefined') {
        throw new Error('createAdminClient must only be used on the server.');
    }
    const { url } = getPublicSupabaseConfig();
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.');
    return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Signs storage paths with the service role (used when rendering the final PDF on the server). */
export function createServiceSigner(admin: ReturnType<typeof createAdminClient>): StorageSigner {
    return async (bucket, paths) => {
        const result = new Map<string, string>();
        const { data, error } = await admin.storage.from(bucket).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
        if (error) throw error;
        for (const item of data ?? []) {
            if (item.path && item.signedUrl && !item.error) result.set(item.path, item.signedUrl);
        }
        return result;
    };
}

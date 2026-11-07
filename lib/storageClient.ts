"use client";

import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/utils/supabase/client';
import {
    SIGNED_URL_TTL_SECONDS,
    parseStorageRef,
    resolveStorageRefs,
    type StorageBucket,
    type StorageSigner,
} from './storage';

// Signed URLs are cached so the live preview (which re-renders on every edit) does
// not request new URLs - and re-download every image - on each keystroke.
const cache = new Map<string, { url: string; expiresAt: number }>();
const SAFETY_MARGIN_MS = 5 * 60 * 1000;

export function createBrowserSigner(supabase: SupabaseClient): StorageSigner {
    return async (bucket: StorageBucket, paths: string[]) => {
        const result = new Map<string, string>();
        const now = Date.now();
        const missing: string[] = [];
        for (const path of paths) {
            const hit = cache.get(`${bucket}/${path}`);
            if (hit && hit.expiresAt - SAFETY_MARGIN_MS > now) result.set(path, hit.url);
            else missing.push(path);
        }
        if (missing.length > 0) {
            const { data, error } = await supabase.storage.from(bucket).createSignedUrls(missing, SIGNED_URL_TTL_SECONDS);
            if (error) throw error;
            for (const item of data ?? []) {
                if (item.path && item.signedUrl && !item.error) {
                    result.set(item.path, item.signedUrl);
                    cache.set(`${bucket}/${item.path}`, { url: item.signedUrl, expiresAt: now + SIGNED_URL_TTL_SECONDS * 1000 });
                }
            }
        }
        return result;
    };
}

/** Replaces every storage reference in `data` with a signed URL the current user may view. */
export function resolveForBrowser<T>(data: T): Promise<T> {
    return resolveStorageRefs(data, createBrowserSigner(createClient()));
}

/** React hook: turns a storage reference (or plain URL) into something an <img> can show. */
export function useResolvedUrl(value: string | null | undefined): string {
    const [resolved, setResolved] = useState<{ key: string; url: string }>({ key: '', url: '' });
    const key = value ?? '';
    useEffect(() => {
        if (!key || !parseStorageRef(key)) return;
        let cancelled = false;
        resolveForBrowser(key).then((url) => {
            if (!cancelled) setResolved({ key, url });
        });
        return () => {
            cancelled = true;
        };
    }, [key]);
    if (!key) return '';
    if (!parseStorageRef(key)) return key; // data:, blob: or external URL - use as is
    return resolved.key === key ? resolved.url : '';
}

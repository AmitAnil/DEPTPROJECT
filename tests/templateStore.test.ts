import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_TEMPLATE_RECORD } from '@/lib/template';
import { loadTemplate } from '@/lib/templateStore';

/** Minimal stand-in for `supabase.from(...).select(...).eq(...).maybeSingle()`. */
function fakeClient(result: { data: unknown; error: { message: string } | null }): SupabaseClient {
    const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => result,
    };
    return { from: () => chain } as unknown as SupabaseClient;
}

const ID = '11111111-1111-1111-1111-111111111111';

describe('loadTemplate', () => {
    it('falls back to the built-in template by default when loading fails', async () => {
        const record = await loadTemplate(fakeClient({ data: null, error: { message: 'timeout' } }), ID);
        expect(record).toBe(DEFAULT_TEMPLATE_RECORD);
    });

    it('throws in strict mode when loading fails (approval must not archive the wrong format)', async () => {
        await expect(loadTemplate(fakeClient({ data: null, error: { message: 'timeout' } }), ID, { strict: true }))
            .rejects.toThrow(/timeout/);
    });

    it('throws in strict mode when the version does not exist', async () => {
        await expect(loadTemplate(fakeClient({ data: null, error: null }), ID, { strict: true }))
            .rejects.toThrow(/not found/);
    });

    it('uses the built-in template for reports without a version, even in strict mode', async () => {
        const record = await loadTemplate(fakeClient({ data: null, error: { message: 'unused' } }), null, { strict: true });
        expect(record).toBe(DEFAULT_TEMPLATE_RECORD);
    });
});

import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_TEMPLATE_RECORD, parseTemplate, type TemplateRecord } from './template';

/**
 * Loads a template version by id (null/unknown -> built-in default). Works with any Supabase client.
 * With `strict`, a version that cannot be loaded throws instead of falling back. Use it where a wrong
 * format would be permanent, e.g. the archived PDF on approval.
 */
export async function loadTemplate(
    supabase: SupabaseClient,
    templateId: string | null | undefined,
    opts: { strict?: boolean } = {},
): Promise<TemplateRecord> {
    if (!templateId) return DEFAULT_TEMPLATE_RECORD;
    const { data, error } = await supabase
        .from('report_templates')
        .select('id, name, definition, is_active, created_at')
        .eq('id', templateId)
        .maybeSingle();
    if (opts.strict && (error || !data)) {
        throw new Error(`Could not load this report's format (${error ? error.message : 'version not found'}). Nothing was archived; please try again.`);
    }
    if (error || !data) {
        if (error) console.error('Could not load report template:', error.message);
        return DEFAULT_TEMPLATE_RECORD;
    }
    return { ...data, definition: parseTemplate(data.definition) };
}

/** The template used for new reports (the active version, or the built-in default). */
export async function loadActiveTemplate(supabase: SupabaseClient): Promise<TemplateRecord> {
    const { data, error } = await supabase
        .from('report_templates')
        .select('id, name, definition, is_active, created_at')
        .eq('is_active', true)
        .maybeSingle();
    if (error) {
        // e.g. the templates migration has not been applied yet
        console.warn('Active template unavailable, using built-in template:', error.message);
        return DEFAULT_TEMPLATE_RECORD;
    }
    return data ? { ...data, definition: parseTemplate(data.definition) } : DEFAULT_TEMPLATE_RECORD;
}

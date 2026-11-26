import type { ReportTemplate, TemplateSection } from './template';

/** A part of the report that could not be drawn and was left out of the preview. */
export interface SkippedPart {
    section: string;
    /** Field label; absent when the whole section had to be left out. */
    field?: string;
}

export interface FallbackResult<T> {
    output: T;
    skipped: SkippedPart[];
    /** The error the full report produced (empty when nothing had to be skipped). */
    error?: string;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Renders the report; if that fails, finds the sections and fields that cannot be drawn
 * (by rendering them on their own), leaves them out and renders the rest.
 * Throws only when even the report without any section fails (e.g. the header).
 */
export async function renderWithFallback<T>(
    template: ReportTemplate,
    render: (template: ReportTemplate) => Promise<T>,
): Promise<FallbackResult<T>> {
    try {
        return { output: await render(template), skipped: [] };
    } catch (first) {
        const works = async (t: ReportTemplate) => {
            try { await render(t); return true; } catch { return false; }
        };
        const only = (section: TemplateSection): ReportTemplate => ({ ...template, sections: [section] });

        const skipped: SkippedPart[] = [];
        const kept: TemplateSection[] = [];
        for (const section of template.sections) {
            if (await works(only(section))) {
                kept.push(section);
                continue;
            }
            // Narrow it down to the fields that cannot be drawn.
            const goodFields = [];
            for (const field of section.fields) {
                if (await works(only({ ...section, fields: [field] }))) goodFields.push(field);
                else skipped.push({ section: section.title, field: field.label });
            }
            if (goodFields.length === section.fields.length) {
                // Every field works alone; the combination fails, so leave the whole section out.
                skipped.push({ section: section.title });
            } else if (goodFields.length > 0) {
                kept.push({ ...section, fields: goodFields });
            }
        }
        if (skipped.length === 0) throw first; // nothing to blame; not a content problem
        const output = await render({ ...template, sections: kept });
        return { output, skipped, error: errorText(first) };
    }
}

/** "Speaker Profile → Speaker Photo, Activity Photos" */
export const describeSkipped = (parts: SkippedPart[]) =>
    parts.map((p) => (p.field ? `${p.section} → ${p.field}` : p.section)).join(', ');

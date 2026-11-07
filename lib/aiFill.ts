// Template-driven AI auto-fill.
//
// The server describes the template's fields to the model (buildExtractionPrompt) and
// validates the answer against the same template (sanitizeAiValues). The editor then
// merges the values (mergeAiValues), by default only into fields that are still empty.

import {
    allFields, filledCount, listValue, textValue,
    type ListItem, type ReportTemplate, type ReportValues, type TemplateField,
} from './template';

/** Free-text notes / dictation saved with the draft (not printed). */
export const AI_NOTES_KEY = 'aiNotes';
/** Extra files the AI may read but that are not printed in the report. */
export const AI_REFERENCE_FILES_KEY = 'aiReferenceFiles';

/** Fields the AI can fill (files, photos and signatures are never AI-generated). */
export function aiFillableFields(template: ReportTemplate): TemplateField[] {
    const seen = new Set<string>();
    return allFields(template).filter((f) => {
        if (['photos', 'attachments', 'preparedBy'].includes(f.type)) return false;
        if ((f.type === 'list' || f.type === 'table') && !(f.subfields ?? []).some((sf) => sf.type !== 'image')) return false;
        if (seen.has(f.id)) return false; // a list shown in two sections is described once
        seen.add(f.id);
        return true;
    });
}

function mergedListColumns(template: ReportTemplate, listId: string) {
    const cols = new Map<string, NonNullable<TemplateField['subfields']>[number]>();
    for (const f of allFields(template)) {
        if ((f.type === 'list' || f.type === 'table') && f.id === listId) for (const sf of f.subfields ?? []) if (sf.type !== 'image') cols.set(sf.id, sf);
    }
    return [...cols.values()];
}

function describeValue(type: string, options?: string[]): string {
    switch (type) {
        case 'number': return 'number as a string, e.g. "42"';
        case 'date': return 'date as "YYYY-MM-DD"';
        case 'time': return 'time as "HH:MM" (24h)';
        case 'select': return `one of: ${JSON.stringify(options ?? [])}`;
        case 'textarea': return 'paragraph text';
        default: return 'short text';
    }
}

/** The JSON shape the model must return, as readable lines for the prompt. */
export function describeTemplateForAi(template: ReportTemplate): string {
    const lines: string[] = [];
    for (const f of aiFillableFields(template)) {
        const help = f.help ? ` (${f.help})` : '';
        if (f.type === 'dateRange' || f.type === 'timeRange') {
            const kind = f.type === 'dateRange' ? 'date' : 'time';
            lines.push(`"${f.id}": start ${describeValue(kind)} for "${f.label}"${help}`);
            lines.push(`"${f.endId}": end ${describeValue(kind)} for "${f.label}" (same as start if a single day/time)`);
        } else if (f.type === 'table' && f.rowLabels) {
            const cols = mergedListColumns(template, f.id).map((sf) => `"${sf.id}": ${describeValue(sf.type, sf.options)} (${sf.label})`);
            lines.push(`"${f.id}": table "${f.label}" as an array with one object per row; "rowLabel" must be one of ${JSON.stringify(f.rowLabels)}; each { "rowLabel", ${cols.join(', ')} }${help}`);
        } else if (f.type === 'list' || f.type === 'table') {
            const cols = mergedListColumns(template, f.id).map((sf) => `"${sf.id}": ${describeValue(sf.type, sf.options)} (${sf.label})`);
            lines.push(`"${f.id}": array of ${f.type === 'table' ? 'table row' : f.itemLabel ?? 'item'} objects for "${f.label}", each { ${cols.join(', ')} }${help}`);
        } else {
            lines.push(`"${f.id}": ${describeValue(f.type, f.options)} for "${f.label}"${help}`);
        }
    }
    return lines.join('\n');
}

export function buildExtractionPrompt(template: ReportTemplate, notes: string): string {
    return `You are helping a university faculty member write an official "${template.header.title || template.name}".
Use the organiser's own description below and the attached documents (brochure, notice for approval,
attendance lists, feedback, photos, voice notes). Write in formal, professional English.

Rules:
- Fill only what the sources support. Use "" (or omit the key) when something is unknown. Never invent names, numbers or dates.
- For attendance counts, count unique names in attendance lists instead of trusting summary text.
- Dropdown fields must use exactly one of the listed options, or "".
- Paragraph fields may use "• " bullet lines.
- If a voice recording is attached, transcribe it mentally and use its content.

Organiser's description:
"""
${notes.trim() || '(none provided - rely on the documents)'}
"""

Return ONLY a JSON object with these keys:
${describeTemplateForAi(template)}`;
}

const clean = (v: unknown, max = 5000): string =>
    (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '').trim().slice(0, max);

function coerce(type: string, raw: unknown, options?: string[]): string {
    const v = clean(raw);
    if (!v) return '';
    switch (type) {
        case 'number': {
            const n = Number.parseFloat(v.replace(/,/g, ''));
            return Number.isFinite(n) && n >= 0 ? String(Math.round(n * 100) / 100) : '';
        }
        case 'date':
            return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
        case 'time': {
            const m = /^(\d{1,2}):(\d{2})/.exec(v);
            return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
        }
        case 'select':
            return options?.find((o) => o.toLowerCase() === v.toLowerCase()) ?? '';
        case 'textarea':
            return v;
        default:
            return v.slice(0, 500);
    }
}

/** Validates untrusted model output against the template. Returns only known, well-typed keys. */
export function sanitizeAiValues(template: ReportTemplate, input: unknown): ReportValues {
    const raw = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
    const out: ReportValues = {};
    for (const f of aiFillableFields(template)) {
        if (f.type === 'dateRange' || f.type === 'timeRange') {
            const kind = f.type === 'dateRange' ? 'date' : 'time';
            const start = coerce(kind, raw[f.id]);
            const end = f.endId ? coerce(kind, raw[f.endId]) : '';
            if (start) out[f.id] = start;
            if (end && f.endId) out[f.endId] = end;
        } else if (f.type === 'list' || f.type === 'table') {
            const cols = mergedListColumns(template, f.id);
            const rowLabels = f.type === 'table' ? f.rowLabels : undefined;
            const items = (Array.isArray(raw[f.id]) ? (raw[f.id] as unknown[]) : [])
                .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x))
                .slice(0, 30)
                .map((x, i) => {
                    const item: ListItem = { id: `ai-${i + 1}` };
                    if (rowLabels) {
                        const label = rowLabels.find((l) => l.toLowerCase() === clean(x.rowLabel).toLowerCase());
                        if (!label) return item; // unknown row -> dropped below
                        item.rowLabel = label;
                    }
                    for (const sf of cols) {
                        const v = coerce(sf.type, x[sf.id], sf.options);
                        if (v) item[sf.id] = v;
                    }
                    return item;
                })
                .filter((item) => Object.keys(item).length > (rowLabels ? 2 : 1));
            if (items.length > 0) out[f.id] = items;
        } else {
            const v = coerce(f.type, raw[f.id], f.options);
            if (v) out[f.id] = v;
        }
    }
    return out;
}

/**
 * Merges AI values into the report. Without `overwrite`, only empty fields are filled.
 * Lists: if the list already has entries, AI values are matched by position and fill
 * empty columns (so photos/bios added for speakers are kept).
 */
export function mergeAiValues(template: ReportTemplate, prev: ReportValues, ai: ReportValues, overwrite: boolean): ReportValues {
    const next: ReportValues = { ...prev };
    for (const f of aiFillableFields(template)) {
        if (f.type === 'list' || f.type === 'table') {
            const incoming = listValue(ai, f.id);
            if (incoming.length === 0) continue;
            const current = listValue(prev, f.id);
            const fillRow = (item: ListItem, ai: ListItem): ListItem => {
                const merged: ListItem = { ...item };
                for (const [k, v] of Object.entries(ai)) {
                    if (k !== 'id' && (overwrite || !textValue(item, k).trim())) merged[k] = v;
                }
                return merged;
            };
            // Rows identified by a dropdown column (e.g. participant type): match on that value.
            const keyCol = f.type === 'table' && f.rowLabels
                ? { id: 'rowLabel' }
                : mergedListColumns(template, f.id).find((sf) => sf.type === 'select');
            if (keyCol && current.length > 0 && current.every((c) => textValue(c, keyCol.id))) {
                const keyOf = (x: ListItem) => textValue(x, keyCol.id).toLowerCase();
                const rows = current.map((c) => {
                    const match = incoming.find((it) => keyOf(it) === keyOf(c));
                    return match ? fillRow(c, match) : c;
                });
                const extra = incoming.filter((it) => keyOf(it) && !current.some((c) => keyOf(c) === keyOf(it)));
                next[f.id] = [...rows, ...extra];
            } else if (filledCount(f, prev) === 0) {
                next[f.id] = incoming.map((item, i) => ({ ...(current[i] ?? {}), ...item, id: current[i]?.id ?? item.id }));
            } else {
                // Match by position and fill empty columns, keeping photos/bios already added.
                next[f.id] = current.map((item, i) => (incoming[i] ? fillRow(item, incoming[i]) : item));
            }
            continue;
        }
        for (const key of [f.id, f.endId].filter((k): k is string => !!k)) {
            if (!(key in ai)) continue;
            if (overwrite || !textValue(prev, key).trim()) next[key] = ai[key];
        }
    }
    return next;
}

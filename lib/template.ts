// Report templates: the configurable structure of a report.
//
// A template lists the sections shown in the editor sidebar and, per section, the
// fields. The same template drives the editor form, the PDF layout, required-field
// checks and the AI auto-fill. Admins edit templates in /admin/templates; every save
// is stored as a new version in `report_templates`, and each report remembers the
// version it was created with (reports.template_id), so changing the format never
// changes existing reports. Reports without a template use DEFAULT_TEMPLATE, which
// reproduces the original hard-coded format exactly.
//
// Values are stored in `reports.data` under the field ids, so the built-in template's
// ids are the original keys (activityTitle, speakers, attendanceFiles, ...).

import { DEPARTMENT_NAME, SCHOOL_NAME, UNIVERSITY_NAME } from './constants';
import { LEGACY_KEYS } from './reportData';

export const TEMPLATE_SCHEMA_VERSION = 1;

export const FIELD_TYPES = [
    'text', 'textarea', 'number', 'date', 'time', 'dateRange', 'timeRange', 'select', 'list', 'table', 'photos', 'attachments', 'preparedBy',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const SUBFIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'image'] as const;
export type SubfieldType = (typeof SUBFIELD_TYPES)[number];

export const LIST_PDF_LAYOUTS = ['cards', 'table', 'profile'] as const;
export type ListPdfLayout = (typeof LIST_PDF_LAYOUTS)[number];

export const SECTION_ICONS = [
    'file-text', 'user', 'users', 'align-left', 'clipboard', 'camera', 'list', 'book', 'shield', 'chart', 'calendar', 'image', 'paperclip', 'star',
] as const;
export type SectionIcon = (typeof SECTION_ICONS)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
    text: 'Short text',
    textarea: 'Paragraph',
    number: 'Number',
    date: 'Date',
    time: 'Time',
    dateRange: 'Date range (start / end)',
    timeRange: 'Time range (start / end)',
    select: 'Dropdown',
    list: 'Repeating group (e.g. speakers)',
    table: 'Table (rows × columns)',
    photos: 'Photos with captions',
    attachments: 'File attachments (PDF / images / Excel)',
    preparedBy: 'Prepared by + signature',
};

export const SUBFIELD_TYPE_LABELS: Record<SubfieldType, string> = {
    text: 'Short text',
    textarea: 'Paragraph',
    number: 'Number',
    date: 'Date',
    select: 'Dropdown',
    image: 'Photo',
};

export interface TemplateSubfield {
    id: string;
    label: string;
    type: SubfieldType;
    options?: string[];
    placeholder?: string;
    /** Column label printed in the PDF if different from the form label. */
    pdfLabel?: string;
}

/** One property bag for all field types keeps the admin editor simple; unused keys are ignored. */
export interface TemplateField {
    id: string;
    label: string;
    type: FieldType;
    required?: boolean;
    help?: string;
    placeholder?: string;
    /** Label printed in the PDF if different from the form label. */
    pdfLabel?: string;
    hideInPdf?: boolean;
    // textarea
    bullets?: boolean;
    // select / subfields
    options?: string[];
    // dateRange / timeRange: second value is stored under endId
    endId?: string;
    // list
    itemLabel?: string;
    subfields?: TemplateSubfield[];
    /** When true the form cannot add/remove items (e.g. a second view of the speakers list). */
    fixedItems?: boolean;
    pdfLayout?: ListPdfLayout;
    // table
    /** Fixed rows (e.g. budget heads). Without them users add rows freely. */
    rowLabels?: string[];
    /** Header of the row-label column. */
    rowHeader?: string;
    /** Adds a total row for number columns. */
    showTotals?: boolean;
    // list / table / photos
    minItems?: number;
    // attachments
    allowSpreadsheets?: boolean;
}

export interface TemplateSection {
    id: string;
    title: string;
    icon?: SectionIcon;
    /** Heading printed in the PDF (defaults to the title). */
    pdfTitle?: string;
    /** Optional line under the PDF heading. `{{fieldId}}` or `{{fieldId|fallback}}` insert values. */
    pdfSubtitle?: string;
    /** Start this section on a new PDF page with a centred heading. */
    newPage?: boolean;
    fields: TemplateField[];
}

export interface ReportTemplate {
    schemaVersion: number;
    name: string;
    header: { lines: string[]; title: string };
    /** Field used as the report's title in lists (default: first text field). */
    titleFieldId?: string;
    sections: TemplateSection[];
}

/** A stored template version (row of `report_templates`). */
export interface TemplateRecord {
    id: string | null; // null = built-in default
    name: string;
    definition: ReportTemplate;
    is_active?: boolean;
    created_at?: string;
}

// ---------------------------------------------------------------------------
// Built-in default (the original DeptDocs activity report)
// ---------------------------------------------------------------------------

const ACTIVITY_TYPES = [
    'Seminar', 'Workshop', 'Conference', 'Technical Talk', 'Guest Talk',
    'Industry Visit', 'Sports', 'Cultural Competition', 'Technical fest/ Academic fests',
    'CAADS', 'Research Clubs / or any other Clubs', 'Newsletter', 'Alumni',
    'Faculty Development Program', 'Quality Improvement Program', 'Refresher Course',
    'MoU', 'Outreach Activity', 'International Event',
];

const SUB_CATEGORIES = [
    'Competitive Exams', 'Career Guidance', 'Skill Development',
    'Communication Skills', 'Women Event', 'Emerging Trends and Technology',
    'Life Skills', 'Soft Skills', 'Others',
];

/** The 17 UN Sustainable Development Goals, for mapping an activity to an SDG. */
const SDG_GOALS = [
    'SDG 1: No Poverty',
    'SDG 2: Zero Hunger',
    'SDG 3: Good Health and Well-being',
    'SDG 4: Quality Education',
    'SDG 5: Gender Equality',
    'SDG 6: Clean Water and Sanitation',
    'SDG 7: Affordable and Clean Energy',
    'SDG 8: Decent Work and Economic Growth',
    'SDG 9: Industry, Innovation and Infrastructure',
    'SDG 10: Reduced Inequalities',
    'SDG 11: Sustainable Cities and Communities',
    'SDG 12: Responsible Consumption and Production',
    'SDG 13: Climate Action',
    'SDG 14: Life Below Water',
    'SDG 15: Life on Land',
    'SDG 16: Peace, Justice and Strong Institutions',
    'SDG 17: Partnerships for the Goals',
];

export const DEFAULT_TEMPLATE: ReportTemplate = {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    name: 'Activity Report (built-in)',
    header: { lines: [UNIVERSITY_NAME, SCHOOL_NAME, DEPARTMENT_NAME], title: 'ACTIVITY REPORT' },
    titleFieldId: 'activityTitle',
    sections: [
        {
            id: 'general', title: 'General Information', icon: 'file-text',
            fields: [
                { id: 'activityTitle', label: 'Title of the Activity', type: 'text', required: true, placeholder: 'Enter title' },
                { id: 'activityType', label: 'Type of Activity', pdfLabel: 'Activity Type', type: 'select', options: ACTIVITY_TYPES },
                { id: 'subCategory', label: 'Sub Category', type: 'select', options: SUB_CATEGORIES },
                { id: 'sdgGoal', label: 'SDG Goal Mapping', pdfLabel: 'SDG Goal', type: 'select', options: SDG_GOALS },
                { id: 'venue', label: 'Venue', type: 'text', placeholder: 'e.g. Panel Room, Block IV' },
                { id: 'collaboration', label: 'Collaboration/ Sponsor', pdfLabel: 'Collaboration/Sponsor', type: 'text', placeholder: 'e.g. Tech Corp / Research Labs' },
                { id: 'date', endId: 'endDate', label: 'Date/s', type: 'dateRange' },
                { id: 'time', endId: 'endTime', label: 'Time', type: 'timeRange' },
            ],
        },
        {
            id: 'speakers', title: 'Speaker/Guest Details', icon: 'user', pdfTitle: 'Speaker/Guest/Presenter Details',
            fields: [{
                id: 'speakers', label: 'Speakers', type: 'list', itemLabel: 'Speaker', pdfLayout: 'cards',
                subfields: [
                    { id: 'name', label: 'Name of the Speaker/Guest/Presenter', pdfLabel: 'Name', type: 'text' },
                    { id: 'designation', label: 'Title/Position', type: 'text' },
                    { id: 'organization', label: 'Organization', type: 'text' },
                    { id: 'contact', label: 'Contact Info', type: 'text' },
                    { id: 'presentationTitle', label: 'Title of Presentation', type: 'text' },
                ],
            }],
        },
        {
            id: 'participants', title: 'Participants Profile', icon: 'users', pdfTitle: 'Participants profile',
            fields: [{
                id: 'participantProfiles', label: 'Participants', type: 'list', itemLabel: 'Group', pdfLayout: 'table',
                subfields: [
                    { id: 'type', label: 'Type of Participants', type: 'select', options: ['Faculty', 'Student', 'Research Scholar', 'Others'] },
                    { id: 'count', label: 'No. of Participants', type: 'number', placeholder: 'Enter count' },
                ],
            }],
        },
        {
            id: 'synopsis', title: 'Synopsis', icon: 'align-left', pdfTitle: 'Synopsis of the Activity',
            fields: [
                { id: 'highlights', label: 'Highlights of the activity', pdfLabel: 'Highlights', type: 'textarea', bullets: true },
                { id: 'takeaways', label: 'Key Takeaways', type: 'textarea', bullets: true },
                { id: 'summary', label: 'Summary of the Activity', pdfLabel: 'Summary', type: 'textarea', bullets: true },
                { id: 'followUpPlan', label: 'Follow Up Plan', pdfLabel: 'Follow-up plan', type: 'textarea', bullets: true },
            ],
        },
        {
            id: 'preparedBy', title: 'Report Prepared By', icon: 'clipboard', pdfTitle: 'Report prepared by',
            fields: [{ id: 'organizersList', label: 'Prepared by', type: 'preparedBy' }],
        },
        {
            id: 'speakerProfile', title: 'Speaker Profile', icon: 'user', newPage: true,
            fields: [{
                id: 'speakers', label: 'Speakers', type: 'list', itemLabel: 'Speaker', fixedItems: true, pdfLayout: 'profile',
                subfields: [
                    { id: 'about', label: 'About the Speaker', type: 'textarea', placeholder: 'Brief biography...' },
                    { id: 'photo', label: 'Speaker Photo', type: 'image' },
                ],
            }],
        },
        {
            id: 'photos', title: 'Activity Photos', icon: 'camera', pdfTitle: 'Photos of the activity', newPage: true,
            pdfSubtitle: '({{activityType|Activity}} - {{date}})',
            fields: [{ id: 'activityPhotos', label: 'Upload Photos', type: 'photos', minItems: 2, required: true }],
        },
        {
            id: 'attendance', title: 'Attendance List', icon: 'list', newPage: true,
            fields: [{ id: 'attendanceFiles', label: 'Upload scanned attendance sheets, images, or exported Excel data', type: 'attachments', allowSpreadsheets: true }],
        },
        {
            id: 'brochure', title: 'Brochure', icon: 'book', pdfTitle: 'Event Brochure', newPage: true,
            fields: [{ id: 'brochureFiles', label: 'Upload Event Brochure', type: 'attachments' }],
        },
        {
            id: 'nfa', title: 'Notice for Approval', icon: 'shield', newPage: true,
            fields: [{ id: 'approvalFiles', label: 'Upload Approval Document', type: 'attachments' }],
        },
        {
            id: 'feedback', title: 'Feedback Analysis', icon: 'chart', newPage: true,
            fields: [{ id: 'feedbackFiles', label: 'Upload Feedback Charts / Documents', type: 'attachments' }],
        },
    ],
};

export const DEFAULT_TEMPLATE_RECORD: TemplateRecord = { id: null, name: DEFAULT_TEMPLATE.name, definition: DEFAULT_TEMPLATE };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,49}$/;
const RESERVED_IDS = new Set([
    'drive_link', 'useProfile', 'useCollaborators', 'aiNotes', 'aiReferenceFiles', 'constructor', 'prototype', '__proto__', 'toString',
    // Old payload keys that normalizeReportData migrates (and would remove from custom fields).
    ...LEGACY_KEYS,
]);
// Keys of the built-in report payload (lib/reportData.ts normalises them to these shapes),
// so a template may only reuse them with a compatible field type.
const SCALAR_TYPES: FieldType[] = ['text', 'textarea', 'number', 'date', 'time', 'dateRange', 'timeRange', 'select'];
const BUILT_IN_ID_TYPES: Record<string, FieldType[]> = {
    activityTitle: SCALAR_TYPES, activityType: SCALAR_TYPES, subCategory: SCALAR_TYPES, venue: SCALAR_TYPES,
    collaboration: SCALAR_TYPES, date: SCALAR_TYPES, time: SCALAR_TYPES, endDate: SCALAR_TYPES, endTime: SCALAR_TYPES,
    highlights: SCALAR_TYPES, takeaways: SCALAR_TYPES, summary: SCALAR_TYPES, followUpPlan: SCALAR_TYPES,
    speakers: ['list', 'table'], participantProfiles: ['list', 'table'],
    organizersList: ['preparedBy'], activityPhotos: ['photos'],
    attendanceFiles: ['attachments'], brochureFiles: ['attachments'], approvalFiles: ['attachments'], feedbackFiles: ['attachments'],
};

const MAX_SECTIONS = 40;
const MAX_FIELDS_PER_SECTION = 40;

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => typeof v === 'object' && v !== null && !Array.isArray(v);
const asStr = (v: unknown, max = 500): string => (typeof v === 'string' ? v.slice(0, max) : '');
const asBool = (v: unknown): boolean | undefined => (v === true ? true : undefined);
const asOptions = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.map((o) => asStr(o, 200).trim()).filter(Boolean).slice(0, 200) : undefined;
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
    typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;

/** Turns a label into a field id, e.g. "Chief Guest" -> "chiefGuest". */
export function slugifyId(label: string, taken: Set<string> = new Set()): string {
    const words = label.normalize('NFKD').replace(/[^a-zA-Z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    let base = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('').slice(0, 40);
    if (!base || !/^[a-zA-Z]/.test(base)) base = `field${base}`;
    let id = base;
    for (let n = 2; taken.has(id) || RESERVED_IDS.has(id); n++) id = `${base}${n}`;
    return id;
}

export interface TemplateValidation {
    ok: boolean;
    errors: string[];
    template: ReportTemplate;
}

/** Cleans an untrusted template definition and reports problems an admin must fix. */
export function validateTemplate(input: unknown): TemplateValidation {
    const errors: string[] = [];
    const raw = isObj(input) ? input : {};
    const header = isObj(raw.header) ? raw.header : {};

    const template: ReportTemplate = {
        schemaVersion: TEMPLATE_SCHEMA_VERSION,
        name: asStr(raw.name, 120).trim(),
        header: {
            lines: (Array.isArray(header.lines) ? header.lines : []).map((l) => asStr(l, 200)).filter((l) => l.trim() !== '').slice(0, 6),
            title: asStr(header.title, 120),
        },
        titleFieldId: asStr(raw.titleFieldId, 60) || undefined,
        sections: [],
    };
    if (!template.name) errors.push('The template needs a name.');

    const rawSections = Array.isArray(raw.sections) ? raw.sections : [];
    if (rawSections.length === 0) errors.push('Add at least one section.');
    if (rawSections.length > MAX_SECTIONS) errors.push(`A template can have at most ${MAX_SECTIONS} sections.`);

    const sectionIds = new Set<string>();
    const fieldOwners = new Map<string, FieldType>(); // id -> type (lists may be shared)

    const claim = (id: string, type: FieldType, where: string) => {
        if (!ID_PATTERN.test(id)) {
            errors.push(`${where}: the id "${id}" must start with a letter and contain only letters, digits and _.`);
            return;
        }
        if (RESERVED_IDS.has(id)) {
            errors.push(`${where}: "${id}" is a reserved id.`);
            return;
        }
        const allowed = BUILT_IN_ID_TYPES[id];
        if (allowed && !allowed.includes(type)) {
            errors.push(`${where}: "${id}" is a built-in field and must be ${allowed.length > 2 ? 'a single-value field' : allowed.map((t) => FIELD_TYPE_LABELS[t]).join(' or ')}. Use a different id.`);
            return;
        }
        const existing = fieldOwners.get(id);
        if (existing && !(existing === 'list' && type === 'list')) {
            errors.push(`${where}: the id "${id}" is already used by another field.`);
            return;
        }
        fieldOwners.set(id, type);
    };

    rawSections.slice(0, MAX_SECTIONS).forEach((rs, si) => {
        const s = isObj(rs) ? rs : {};
        const title = asStr(s.title, 120).trim();
        const where = `Section ${si + 1}${title ? ` "${title}"` : ''}`;
        let id = asStr(s.id, 60);
        if (!ID_PATTERN.test(id) || sectionIds.has(id)) id = slugifyId(title || `section ${si + 1}`, sectionIds);
        sectionIds.add(id);
        if (!title) errors.push(`${where}: needs a title.`);

        const section: TemplateSection = {
            id,
            title,
            icon: oneOf(s.icon, SECTION_ICONS),
            pdfTitle: asStr(s.pdfTitle, 160) || undefined,
            pdfSubtitle: asStr(s.pdfSubtitle, 200) || undefined,
            newPage: asBool(s.newPage),
            fields: [],
        };

        const rawFields = Array.isArray(s.fields) ? s.fields : [];
        if (rawFields.length === 0) errors.push(`${where}: add at least one field.`);
        if (rawFields.length > MAX_FIELDS_PER_SECTION) errors.push(`${where}: at most ${MAX_FIELDS_PER_SECTION} fields per section.`);

        rawFields.slice(0, MAX_FIELDS_PER_SECTION).forEach((rf, fi) => {
            const f = isObj(rf) ? rf : {};
            const label = asStr(f.label, 200).trim();
            const fWhere = `${where}, field ${fi + 1}${label ? ` "${label}"` : ''}`;
            const type = oneOf(f.type, FIELD_TYPES);
            if (!type) {
                errors.push(`${fWhere}: unknown field type.`);
                return;
            }
            if (!label) errors.push(`${fWhere}: needs a label.`);
            const fieldId = asStr(f.id, 60);
            claim(fieldId, type, fWhere);

            const field: TemplateField = {
                id: fieldId,
                label,
                type,
                required: asBool(f.required),
                help: asStr(f.help, 300) || undefined,
                placeholder: asStr(f.placeholder, 200) || undefined,
                pdfLabel: asStr(f.pdfLabel, 200) || undefined,
                hideInPdf: asBool(f.hideInPdf),
            };

            if (type === 'textarea') field.bullets = asBool(f.bullets);
            if (type === 'select') {
                field.options = asOptions(f.options) ?? [];
                if (field.options.length === 0) errors.push(`${fWhere}: a dropdown needs at least one option.`);
            }
            if (type === 'dateRange' || type === 'timeRange') {
                const endId = asStr(f.endId, 60) || `${fieldId}End`;
                field.endId = endId;
                claim(endId, type, `${fWhere} (end value)`);
            }
            if (type === 'table') {
                field.rowLabels = asOptions(f.rowLabels);
                if (field.rowLabels && field.rowLabels.length === 0) field.rowLabels = undefined;
                field.rowHeader = asStr(f.rowHeader, 100) || undefined;
                field.showTotals = asBool(f.showTotals);
            }
            if (type === 'list' || type === 'table') {
                if (type === 'list') {
                    field.itemLabel = asStr(f.itemLabel, 60) || 'Item';
                    field.fixedItems = asBool(f.fixedItems);
                    field.pdfLayout = oneOf(f.pdfLayout, LIST_PDF_LAYOUTS) ?? 'cards';
                }
                const subIds = new Set<string>();
                field.subfields = (Array.isArray(f.subfields) ? f.subfields : []).slice(0, 30).flatMap((rsf, ki) => {
                    const sf = isObj(rsf) ? rsf : {};
                    const sLabel = asStr(sf.label, 200).trim();
                    const sType = oneOf(sf.type, SUBFIELD_TYPES);
                    const sid = asStr(sf.id, 60);
                    const sWhere = `${fWhere}, column ${ki + 1}${sLabel ? ` "${sLabel}"` : ''}`;
                    if (!sType) {
                        errors.push(`${sWhere}: unknown type.`);
                        return [];
                    }
                    if (!sLabel) errors.push(`${sWhere}: needs a label.`);
                    if (type === 'table' && sType === 'image') errors.push(`${sWhere}: tables cannot contain photos.`);
                    if (!ID_PATTERN.test(sid) || sid === 'id') errors.push(`${sWhere}: invalid id "${sid}".`);
                    else if (subIds.has(sid)) errors.push(`${sWhere}: duplicate id "${sid}".`);
                    subIds.add(sid);
                    const sub: TemplateSubfield = { id: sid, label: sLabel, type: sType, placeholder: asStr(sf.placeholder, 200) || undefined, pdfLabel: asStr(sf.pdfLabel, 200) || undefined };
                    if (sType === 'select') {
                        sub.options = asOptions(sf.options) ?? [];
                        if (sub.options.length === 0) errors.push(`${sWhere}: a dropdown needs at least one option.`);
                    }
                    return [sub];
                });
                if (field.subfields.length === 0) errors.push(`${fWhere}: ${type === 'table' ? 'a table' : 'a repeating group'} needs at least one column.`);
            }
            if (type === 'list' || type === 'table' || type === 'photos') {
                const min = typeof f.minItems === 'number' ? Math.floor(f.minItems) : 0;
                field.minItems = min > 0 ? Math.min(min, 50) : undefined;
            }
            if (type === 'attachments') field.allowSpreadsheets = asBool(f.allowSpreadsheets);

            section.fields.push(field);
        });
        template.sections.push(section);
    });

    if (template.titleFieldId && fieldOwners.get(template.titleFieldId) !== 'text') {
        template.titleFieldId = undefined;
    }

    return { ok: errors.length === 0, errors, template };
}

/** Parses a stored definition; falls back to the built-in template if it is unusable. */
export function parseTemplate(input: unknown): ReportTemplate {
    const result = validateTemplate(input);
    return result.ok ? result.template : DEFAULT_TEMPLATE;
}

// ---------------------------------------------------------------------------
// Working with values
// ---------------------------------------------------------------------------

export type ReportValues = Record<string, unknown>;
export type ListItem = Record<string, unknown> & { id: string | number };

export function allFields(template: ReportTemplate): TemplateField[] {
    return template.sections.flatMap((s) => s.fields);
}

/** Every data key the template reads or writes. */
export function templateValueKeys(template: ReportTemplate): Set<string> {
    const keys = new Set<string>();
    for (const f of allFields(template)) {
        keys.add(f.id);
        if (f.endId) keys.add(f.endId);
    }
    return keys;
}

export const textValue = (data: ReportValues, key: string | undefined): string => {
    if (!key) return '';
    const v = data[key];
    return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
};

export const listValue = (data: ReportValues, key: string): ListItem[] => {
    const v = data[key];
    if (!Array.isArray(v)) return [];
    return v.filter(isObj).map((item, i) => ({ ...item, id: typeof item.id === 'string' || typeof item.id === 'number' ? item.id : `item-${i + 1}` }));
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-03-12" -> "12th March 2026" (deterministic, no locale dependence). */
export function formatDate(value: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!m) return value;
    const day = Number(m[3]);
    const month = MONTHS[Number(m[2]) - 1];
    if (!month || day < 1 || day > 31) return value;
    const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
    return `${day}${suffix} ${month} ${m[1]}`;
}

/** Display string for a single-value field (empty string when not filled). */
export function formatFieldValue(field: TemplateField, data: ReportValues): string {
    const v = textValue(data, field.id).trim();
    switch (field.type) {
        case 'date':
            return v ? formatDate(v) : '';
        case 'dateRange': {
            const end = textValue(data, field.endId).trim();
            if (!v) return '';
            return end && end !== v ? `${formatDate(v)} to ${formatDate(end)}` : formatDate(v);
        }
        case 'timeRange': {
            const end = textValue(data, field.endId).trim();
            if (!v) return '';
            return end && end !== v ? `${v} to ${end}` : v;
        }
        default:
            return v;
    }
}

export function isScalarField(field: TemplateField): boolean {
    return ['text', 'textarea', 'number', 'date', 'time', 'dateRange', 'timeRange', 'select'].includes(field.type);
}

const filledItem = (item: ListItem, subfields: TemplateSubfield[]) =>
    subfields.some((sf) => {
        const v = item[sf.id];
        return typeof v === 'string' ? v.trim() !== '' : typeof v === 'number';
    });

/** Number of filled entries for list/photos/attachments, 1/0 for single values. */
export function filledCount(field: TemplateField, data: ReportValues): number {
    switch (field.type) {
        case 'list':
        case 'table':
            return listValue(data, field.id).filter((item) => filledItem(item, field.subfields ?? [])).length;
        case 'photos':
            return listValue(data, field.id).filter((p) => typeof p.url === 'string' && p.url !== '').length;
        case 'attachments':
            return listValue(data, field.id).length;
        case 'preparedBy':
            return listValue(data, field.id).filter((o) => textValue(o, 'name').trim() !== '').length;
        default:
            return formatFieldValue(field, data) !== '' ? 1 : 0;
    }
}

/** Labels of required fields that are still empty, grouped as "Section: Field". */
export function missingRequired(template: ReportTemplate, data: ReportValues): string[] {
    const missing: string[] = [];
    for (const section of template.sections) {
        for (const field of section.fields) {
            const need = Math.max(field.required ? 1 : 0, field.minItems ?? 0);
            const have = filledCount(field, data);
            if (have < need) {
                missing.push(`${section.title}: ${field.label}${need > 1 ? ` (at least ${need})` : ''}`);
            }
        }
    }
    return missing;
}

/** Replaces {{fieldId}} / {{fieldId|fallback}} with formatted values. */
export function interpolate(text: string, template: ReportTemplate, data: ReportValues): string {
    const byId = new Map(allFields(template).map((f) => [f.id, f]));
    return text.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*(?:\|([^}]*))?\}\}/g, (_, id: string, fallback?: string) => {
        const field = byId.get(id);
        const value = field ? formatFieldValue(field, data) : textValue(data, id);
        return value || (fallback ?? '').trim() || '—';
    });
}

/** Title shown in report lists. */
export function reportTitleFrom(template: ReportTemplate, data: ReportValues): string {
    const id = template.titleFieldId ?? allFields(template).find((f) => f.type === 'text')?.id;
    return textValue(data, id).trim() || 'Untitled Report';
}

/** Placeholder data so admins can preview a template's PDF layout. */
export function sampleData(template: ReportTemplate): ReportValues {
    const data: ReportValues = {};
    for (const field of allFields(template)) {
        switch (field.type) {
            case 'number':
                data[field.id] = '25';
                break;
            case 'date':
                data[field.id] = '2026-03-12';
                break;
            case 'time':
                data[field.id] = '10:00';
                break;
            case 'dateRange':
                data[field.id] = '2026-03-12';
                if (field.endId) data[field.endId] = '2026-03-13';
                break;
            case 'timeRange':
                data[field.id] = '10:00';
                if (field.endId) data[field.endId] = '13:00';
                break;
            case 'select':
                data[field.id] = field.options?.[0] ?? '';
                break;
            case 'list': {
                const existing = Array.isArray(data[field.id]) ? (data[field.id] as ListItem[]) : [{ id: 1 }, { id: 2 }];
                data[field.id] = existing.map((item, i) => {
                    const next: ListItem = { ...item };
                    for (const sf of field.subfields ?? []) {
                        if (sf.type === 'image') continue;
                        next[sf.id] = sf.type === 'number' ? String(10 * (i + 1)) : sf.type === 'select' ? sf.options?.[i % (sf.options?.length || 1)] ?? '' : sf.type === 'date' ? '2026-03-12' : `${sf.label} ${i + 1}`;
                    }
                    return next;
                });
                break;
            }
            case 'table': {
                const labels = field.rowLabels ?? ['Row 1', 'Row 2'];
                data[field.id] = labels.map((label, i) => {
                    const row: ListItem = { id: `row-${i + 1}`, ...(field.rowLabels ? { rowLabel: label } : {}) };
                    for (const sf of field.subfields ?? []) {
                        row[sf.id] = sf.type === 'number' ? String(100 * (i + 1)) : sf.type === 'select' ? sf.options?.[0] ?? '' : sf.type === 'date' ? '2026-03-12' : `${sf.label} ${i + 1}`;
                    }
                    return row;
                });
                break;
            }
            case 'preparedBy':
                data[field.id] = [{ name: 'Faculty Name', designation: 'Assistant Professor', signatureImage: '' }];
                break;
            case 'photos':
            case 'attachments':
                data[field.id] = [];
                break;
            default:
                data[field.id] = field.type === 'textarea' ? `${field.label}: sample paragraph text that shows how this section is laid out in the PDF.` : `Sample ${field.label}`;
        }
    }
    return data;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/** Key under which fixed table rows store their label. */
export const TABLE_ROW_LABEL_KEY = 'rowLabel';

/** Rows of a table field; with fixed row labels there is always exactly one row per label. */
export function tableRows(field: TemplateField, data: ReportValues): ListItem[] {
    const stored = listValue(data, field.id);
    if (!field.rowLabels) return stored;
    return field.rowLabels.map((label, i) => {
        // Match by label; fall back to position only for rows saved without a label.
        const byPosition = stored[i] && !textValue(stored[i], TABLE_ROW_LABEL_KEY) ? stored[i] : undefined;
        const match = stored.find((r) => textValue(r, TABLE_ROW_LABEL_KEY) === label) ?? byPosition;
        return { ...(match ?? {}), id: match?.id ?? `row-${i + 1}`, [TABLE_ROW_LABEL_KEY]: label };
    });
}

/** Column totals for number columns (empty string when a column has no numbers). */
export function tableTotals(field: TemplateField, rows: ListItem[]): Record<string, string> {
    const totals: Record<string, string> = {};
    for (const sf of field.subfields ?? []) {
        if (sf.type !== 'number') continue;
        let sum = 0;
        let any = false;
        for (const r of rows) {
            const n = Number.parseFloat(textValue(r, sf.id).replace(/,/g, ''));
            if (Number.isFinite(n)) { sum += n; any = true; }
        }
        totals[sf.id] = any ? String(Math.round(sum * 100) / 100) : '';
    }
    return totals;
}

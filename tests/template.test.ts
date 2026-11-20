import { describe, expect, it } from 'vitest';
import { normalizeReportData } from '@/lib/reportData';
import {
    DEFAULT_TEMPLATE, formatDate, formatFieldValue, interpolate, missingRequired, parseTemplate, reportTitleFrom,
    sampleData, slugifyId, templateValueKeys, validateTemplate, type ReportTemplate,
} from '@/lib/template';

const minimal = (fields: unknown[]): unknown => ({
    name: 'Test', header: { lines: ['Uni'], title: 'REPORT' },
    sections: [{ id: 'main', title: 'Main', fields }],
});

describe('built-in template', () => {
    it('is valid', () => {
        const r = validateTemplate(DEFAULT_TEMPLATE);
        expect(r.errors).toEqual([]);
        expect(r.ok).toBe(true);
    });

    it('covers every key of the original report payload', () => {
        const keys = templateValueKeys(DEFAULT_TEMPLATE);
        const builtIn = Object.keys(normalizeReportData({})).filter((k) => !['useProfile', 'useCollaborators'].includes(k));
        for (const k of builtIn) expect(keys.has(k), k).toBe(true);
    });

    it('requires at least two activity photos', () => {
        const missing = missingRequired(DEFAULT_TEMPLATE, normalizeReportData({ activityTitle: 'X', activityPhotos: [{ id: '1', url: 'sb://reports/a.jpg' }] }));
        expect(missing).toContain('Activity Photos: Upload Photos: upload at least 2 photos.');
    });
});

describe('validateTemplate', () => {
    it('rejects duplicate, reserved and malformed ids', () => {
        const r = validateTemplate(minimal([
            { id: 'title', label: 'Title', type: 'text' },
            { id: 'title', label: 'Again', type: 'text' },
            { id: 'drive_link', label: 'Link', type: 'text' },
            { id: '1bad', label: 'Bad', type: 'text' },
        ]));
        expect(r.ok).toBe(false);
        expect(r.errors.join('\n')).toMatch(/already used/);
        expect(r.errors.join('\n')).toMatch(/reserved/);
        expect(r.errors.join('\n')).toMatch(/must start with a letter/);
    });

    it('allows two sections to show the same list', () => {
        const r = validateTemplate({
            name: 'T', header: { lines: [], title: '' },
            sections: [
                { id: 'a', title: 'A', fields: [{ id: 'people', label: 'People', type: 'list', subfields: [{ id: 'name', label: 'Name', type: 'text' }] }] },
                { id: 'b', title: 'B', fields: [{ id: 'people', label: 'Bios', type: 'list', fixedItems: true, subfields: [{ id: 'bio', label: 'Bio', type: 'textarea' }] }] },
            ],
        });
        expect(r.errors).toEqual([]);
    });

    it('requires dropdown options and list columns', () => {
        const r = validateTemplate(minimal([
            { id: 'kind', label: 'Kind', type: 'select', options: [] },
            { id: 'rows', label: 'Rows', type: 'list', subfields: [] },
        ]));
        expect(r.errors.some((e) => e.includes('at least one option'))).toBe(true);
        expect(r.errors.some((e) => e.includes('at least one column'))).toBe(true);
    });

    it('strips unknown properties and clamps sizes', () => {
        const r = validateTemplate(minimal([{ id: 'x', label: 'X', type: 'text', evil: '<script>', minItems: 9999 }]));
        expect(r.ok).toBe(true);
        expect(r.template.sections[0].fields[0]).not.toHaveProperty('evil');
    });

    it('falls back to the built-in template when a stored one is broken', () => {
        expect(parseTemplate({ sections: 'nope' })).toBe(DEFAULT_TEMPLATE);
    });

    it('assigns end ids for ranges', () => {
        const r = validateTemplate(minimal([{ id: 'when', label: 'When', type: 'dateRange' }]));
        expect(r.template.sections[0].fields[0].endId).toBe('whenEnd');
    });
});

describe('values', () => {
    const t = DEFAULT_TEMPLATE;
    it('formats dates and ranges', () => {
        expect(formatDate('2026-03-01')).toBe('1st March 2026');
        expect(formatDate('2026-03-12')).toBe('12th March 2026');
        expect(formatDate('2026-03-22')).toBe('22nd March 2026');
        const dateField = t.sections[0].fields.find((f) => f.id === 'date')!;
        expect(formatFieldValue(dateField, { date: '2026-03-12', endDate: '2026-03-13' })).toBe('12th March 2026 to 13th March 2026');
        expect(formatFieldValue(dateField, { date: '2026-03-12', endDate: '2026-03-12' })).toBe('12th March 2026');
    });

    it('interpolates subtitles with fallbacks', () => {
        expect(interpolate('({{activityType|Activity}} - {{date}})', t, { date: '2026-03-12' })).toBe('(Activity - 12th March 2026)');
    });

    it('derives the report title', () => {
        expect(reportTitleFrom(t, { activityTitle: '  AI Day ' })).toBe('AI Day');
        expect(reportTitleFrom(t, {})).toBe('Untitled Report');
    });

    it('builds sample data for previews', () => {
        const data = sampleData(t);
        expect(Array.isArray(data.speakers)).toBe(true);
        expect(data.endDate).toBe('2026-03-13');
    });

    it('creates readable unique ids', () => {
        expect(slugifyId('Chief Guest')).toBe('chiefGuest');
        expect(slugifyId('Chief Guest', new Set(['chiefGuest']))).toBe('chiefGuest2');
        expect(slugifyId('2nd day')).toBe('field2ndDay');
    });
});

export const CUSTOM: ReportTemplate = validateTemplate(minimal([
    { id: 'eventName', label: 'Event name', type: 'text', required: true },
    { id: 'mode', label: 'Mode', type: 'select', options: ['Online', 'Offline'] },
])).template;

describe('review fixes', () => {
    it('rejects built-in ids reused with an incompatible type', () => {
        const r = validateTemplate({
            name: 'T', header: { lines: [], title: '' },
            sections: [{ id: 's', title: 'S', fields: [
                { id: 'speakers', label: 'Speakers', type: 'text' },
                { id: 'activityPhotos', label: 'Photos', type: 'attachments' },
                { id: 'activityTitle', label: 'Title', type: 'textarea' },
            ] }],
        });
        expect(r.errors.filter((e) => e.includes('built-in'))).toHaveLength(2);
    });

    it('keeps custom columns on built-in lists', () => {
        const data = normalizeReportData({
            speakers: [{ id: 1, name: 'Dr. A', email: 'a@iisc.ac.in' }],
            participantProfiles: [{ id: 1, type: 'Student', count: '3', remarks: 'UG' }],
            activityPhotos: [{ id: 'p', url: 'sb://reports/x.jpg', credit: 'Media club' }],
            organizersList: [{ name: 'B', employeeId: 'E1' }],
        });
        expect(data.speakers[0]).toMatchObject({ name: 'Dr. A', email: 'a@iisc.ac.in' });
        expect(data.participantProfiles[0]).toMatchObject({ remarks: 'UG' });
        expect(data.activityPhotos[0]).toMatchObject({ credit: 'Media club' });
        expect(data.organizersList[0]).toMatchObject({ employeeId: 'E1' });
    });
});

describe('second review round', () => {
    it('does not resurrect legacy speaker aliases after the user clears a field', () => {
        const first = normalizeReportData({ speakers: [{ id: 1, name: 'Dr. A', title: 'Prof', photoUrl: 'sb://reports/x.jpg', email: 'a@x.in' }] });
        expect(first.speakers[0]).toMatchObject({ designation: 'Prof', photo: 'sb://reports/x.jpg', email: 'a@x.in' });
        expect(first.speakers[0]).not.toHaveProperty('title');
        expect(first.speakers[0]).not.toHaveProperty('photoUrl');
        const cleared = { ...first, speakers: [{ ...first.speakers[0], designation: '', photo: null }] };
        const reloaded = normalizeReportData(JSON.parse(JSON.stringify(cleared)));
        expect(reloaded.speakers[0]).toMatchObject({ designation: '', photo: null, email: 'a@x.in' });
    });

    it('never generates or accepts legacy payload keys as field ids', () => {
        expect(slugifyId('Start date')).toBe('startDate2');
        const r = validateTemplate({ name: 'T', header: { lines: [], title: '' }, sections: [{ id: 's', title: 'S', fields: [{ id: 'startDate', label: 'Start', type: 'date' }] }] });
        expect(r.errors.join()).toMatch(/reserved/);
    });
});

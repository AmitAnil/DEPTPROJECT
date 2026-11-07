import { describe, expect, it } from 'vitest';
import { buildExtractionPrompt, mergeAiValues, sanitizeAiValues } from '@/lib/aiFill';
import { normalizeReportData } from '@/lib/reportData';
import { DEFAULT_TEMPLATE, validateTemplate } from '@/lib/template';

describe('AI prompt', () => {
    it('describes the template fields and includes the notes', () => {
        const prompt = buildExtractionPrompt(DEFAULT_TEMPLATE, 'We ran a workshop.');
        expect(prompt).toContain('"activityTitle"');
        expect(prompt).toContain('"endDate"');
        expect(prompt).toContain('"speakers": array of Speaker objects');
        expect(prompt).toContain('"about"'); // columns from both speaker sections
        expect(prompt).not.toContain('"activityPhotos"'); // files are never AI-generated
        expect(prompt).toContain('We ran a workshop.');
    });
});

describe('sanitizeAiValues', () => {
    it('keeps only known, well-typed values', () => {
        const out = sanitizeAiValues(DEFAULT_TEMPLATE, {
            activityTitle: 'GenAI Workshop',
            activityType: 'workshop', // case-insensitive option match
            subCategory: 'Not an option',
            date: '12/03/2026', // wrong format -> dropped
            endDate: '2026-03-13',
            time: '9:30',
            speakers: [{ name: 'Dr. A', organization: 'IISc', photo: 'https://evil' }, { nonsense: 1 }],
            participantProfiles: [{ type: 'Student', count: '57' }],
            activityPhotos: [{ url: 'x' }],
            injected: 'x',
        });
        expect(out.activityTitle).toBe('GenAI Workshop');
        expect(out.activityType).toBe('Workshop');
        expect(out).not.toHaveProperty('subCategory');
        expect(out).not.toHaveProperty('date');
        expect(out.endDate).toBe('2026-03-13');
        expect(out.time).toBe('09:30');
        expect(out.speakers).toEqual([{ id: 'ai-1', name: 'Dr. A', organization: 'IISc' }]);
        expect(out).not.toHaveProperty('activityPhotos');
        expect(out).not.toHaveProperty('injected');
    });

    it('works for custom templates', () => {
        const t = validateTemplate({
            name: 'FDP', header: { lines: [], title: 'FDP REPORT' },
            sections: [{ id: 's', title: 'S', fields: [{ id: 'budget', label: 'Budget', type: 'number' }, { id: 'mode', label: 'Mode', type: 'select', options: ['Online', 'Offline'] }] }],
        }).template;
        expect(sanitizeAiValues(t, { budget: '12,500', mode: 'ONLINE', activityTitle: 'x' })).toEqual({ budget: '12500', mode: 'Online' });
    });
});

describe('mergeAiValues', () => {
    it('fills only empty fields unless overwrite is on', () => {
        const prev = normalizeReportData({ venue: 'Main Hall' });
        const ai = { venue: 'Auditorium', activityTitle: 'AI Day' };
        expect(mergeAiValues(DEFAULT_TEMPLATE, prev, ai, false)).toMatchObject({ venue: 'Main Hall', activityTitle: 'AI Day' });
        expect(mergeAiValues(DEFAULT_TEMPLATE, prev, ai, true)).toMatchObject({ venue: 'Auditorium' });
    });

    it('fills participant counts by type', () => {
        const prev = normalizeReportData({});
        const next = mergeAiValues(DEFAULT_TEMPLATE, prev, { participantProfiles: [{ id: 'ai-1', type: 'Faculty', count: '8' }, { id: 'ai-2', type: 'Student', count: '60' }] }, false);
        const rows = next.participantProfiles as { type: string; count: string }[];
        expect(rows.find((r) => r.type === 'Student')?.count).toBe('60');
        expect(rows.find((r) => r.type === 'Faculty')?.count).toBe('8');
        expect(rows).toHaveLength(3);
    });

    it('keeps speaker photos when filling details', () => {
        const prev = normalizeReportData({ speakers: [{ id: 's1', name: '', photo: 'sb://reports/p.jpg' }] });
        const next = mergeAiValues(DEFAULT_TEMPLATE, prev, { speakers: [{ id: 'ai-1', name: 'Dr. A' }] }, false);
        expect(next.speakers).toEqual([expect.objectContaining({ id: 's1', name: 'Dr. A', photo: 'sb://reports/p.jpg' })]);
    });
});

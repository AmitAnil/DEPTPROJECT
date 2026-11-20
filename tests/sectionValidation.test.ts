import { describe, expect, it } from 'vitest';
import { normalizeReportData } from '@/lib/reportData';
import {
    DEFAULT_TEMPLATE, fieldProblems, firstIncompleteSection, missingRequired, parseTemplate, sectionProblems,
    type ReportValues, type TemplateSection,
} from '@/lib/template';

const section = (id: string): TemplateSection => DEFAULT_TEMPLATE.sections.find((s) => s.id === id)!;
const file = (n: number) => ({ id: `f${n}`, name: `f${n}.pdf`, url: `sb://reports/f${n}.pdf`, type: 'application/pdf' });

/** A report with every field of the built-in format filled in. */
function completeReport(): ReportValues {
    return normalizeReportData({
        activityTitle: 'AI Workshop', activityType: 'Workshop', subCategory: 'Skill Development',
        sdgGoal: 'SDG 4: Quality Education', activityLevel: 'Department', activityMode: 'Offline',
        venue: 'Seminar Hall', collaboration: 'None',
        date: '2026-11-20', endDate: '2026-11-20', time: '10:00', endTime: '12:00',
        speakers: [{
            id: 's1', name: 'Dr. A', designation: 'Professor', organization: 'IISc', contact: 'a@example.com',
            presentationTitle: 'LLMs', about: 'Researcher in NLP.', photo: 'sb://reports/s1.jpg',
        }],
        participantProfiles: [{ id: 1, type: 'Student', count: '60' }, { id: 2, type: 'Faculty', count: '0' }],
        highlights: 'a', takeaways: 'b', summary: 'c', followUpPlan: 'd',
        organizersList: [{ name: 'Prof. B', designation: 'Assistant Professor', signatureImage: '' }],
        activityPhotos: [{ id: 'p1', url: 'sb://reports/1.jpg' }, { id: 'p2', url: 'sb://reports/2.jpg' }],
        attendanceFiles: [file(1)], brochureFiles: [file(2)], approvalFiles: [file(3)], feedbackFiles: [file(4)],
    });
}

describe('section validation (built-in format)', () => {
    it('accepts a fully filled report', () => {
        const data = completeReport();
        expect(missingRequired(DEFAULT_TEMPLATE, data)).toEqual([]);
        expect(firstIncompleteSection(DEFAULT_TEMPLATE, data)).toBe(-1);
    });

    it('requires every General Information field, including the SDG goal', () => {
        const data = { ...completeReport(), sdgGoal: '', venue: '  ' };
        const messages = sectionProblems(section('general'), data).map((p) => p.message);
        expect(messages).toEqual(['SDG Goal Mapping: choose an option (or pick "Others" and type your own).', 'Venue: this field is required.']);
        expect(firstIncompleteSection(DEFAULT_TEMPLATE, data)).toBe(0);
    });

    it('requires both ends of a date or time range', () => {
        const data = { ...completeReport(), endDate: '', time: '' };
        const messages = sectionProblems(section('general'), data).map((p) => p.message);
        expect(messages).toEqual(['Date/s: choose the end date.', 'Time: choose the start time.']);
    });

    it('names the empty columns of each speaker', () => {
        const base = completeReport();
        const speakers = [
            { ...(base.speakers as object[])[0] },
            { id: 's2', name: 'Ms. C', designation: '', organization: 'Acme', contact: '', presentationTitle: 'Talk', about: '', photo: null },
        ];
        const data = { ...base, speakers };
        expect(sectionProblems(section('speakers'), data).map((p) => p.message))
            .toEqual(['Speaker 2: fill in Title/Position, Contact Info.']);
        expect(sectionProblems(section('speakerProfile'), data).map((p) => p.message))
            .toEqual(['Speaker 2: fill in About the Speaker, Speaker Photo.']);
    });

    it('treats a participant count of 0 as filled but an empty count as missing', () => {
        const base = completeReport();
        const data = { ...base, participantProfiles: [{ id: 1, type: 'Student', count: '' }, { id: 2, type: 'Faculty', count: '0' }] };
        expect(sectionProblems(section('participants'), data).map((p) => p.message)).toEqual(['Group 1: fill in No. of Participants.']);
    });

    it('requires the name and designation of the person who prepared the report', () => {
        const data = { ...completeReport(), organizersList: [{ name: 'Prof. B', designation: '', signatureImage: '' }] };
        expect(sectionProblems(section('preparedBy'), data).map((p) => p.message)).toEqual(['Prepared by: enter the designation.']);
    });

    it('requires an upload in every document section', () => {
        const data = { ...completeReport(), brochureFiles: [] };
        expect(missingRequired(DEFAULT_TEMPLATE, data)).toEqual(['Brochure: Upload Event Brochure: upload at least one file.']);
    });

    it('ties every problem to the field it belongs to', () => {
        const problems = sectionProblems(section('general'), normalizeReportData({}));
        const ids = new Set(section('general').fields.map((f) => f.id));
        expect(problems.length).toBeGreaterThan(0);
        expect(problems.every((p) => ids.has(p.fieldId))).toBe(true);
    });
});

describe('optional fields and admin formats', () => {
    it('does not complain about optional fields', () => {
        const field = { id: 'note', label: 'Note', type: 'text' as const };
        expect(fieldProblems(field, {})).toEqual([]);
    });

    it('keeps suggestions and required columns when an admin saves a format', () => {
        const t = parseTemplate({
            schemaVersion: 1, name: 'T', header: { lines: [], title: 'R' },
            sections: [{
                id: 's', title: 'S', fields: [
                    { id: 'place', label: 'Place', type: 'text', suggestions: ['Hall A', ' ', 'Hall B'] },
                    { id: 'people', label: 'People', type: 'list', subfields: [{ id: 'role', label: 'Role', type: 'text', required: true, suggestions: ['Chair'] }] },
                ],
            }],
        });
        const [place, people] = t.sections[0].fields;
        expect(place.suggestions).toEqual(['Hall A', 'Hall B']);
        expect(people.subfields?.[0]).toMatchObject({ required: true, suggestions: ['Chair'] });
    });

    it('has the new General Information dropdowns', () => {
        const fields = section('general').fields;
        expect(fields.find((f) => f.id === 'activityMode')?.options).toEqual(['Offline', 'Online', 'Hybrid']);
        expect(fields.find((f) => f.id === 'activityLevel')?.options).toContain('National');
        expect(fields.find((f) => f.id === 'sdgGoal')?.options).toHaveLength(17);
        expect(parseTemplate(DEFAULT_TEMPLATE).sections[0].fields.map((f) => f.id)).toEqual(fields.map((f) => f.id));
    });
});

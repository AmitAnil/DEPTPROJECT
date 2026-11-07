import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToBuffer } from '@react-pdf/renderer';
import { ReportPDF } from '@/components/ReportPDF';
import { normalizeReportData } from '@/lib/reportData';
import { DEFAULT_TEMPLATE, sampleData, validateTemplate } from '@/lib/template';

const isPdf = (buf: Buffer) => buf.subarray(0, 5).toString() === '%PDF-';

describe('ReportPDF', () => {
    it('renders the built-in template with a legacy report payload', async () => {
        const data = normalizeReportData({
            activityTitle: 'GenAI Workshop', activityType: 'Workshop', venue: 'Block IV', date: '2026-03-12', endDate: '2026-03-13', time: '10:00',
            speakers: [{ id: 1, name: 'Dr. A', title: 'Professor', about: 'Bio' }],
            participantsProfile: [{ id: 1, type: 'Student', count: '60' }],
            highlights: '• One\n• Two', followUp: 'Next',
            attendanceFiles: [{ id: 'x', name: 'list.csv', type: 'csv', pages: [], jsonData: [{ Name: 'A', Reg: 1 }] }],
        });
        const buf = await renderToBuffer(<ReportPDF data={data} template={DEFAULT_TEMPLATE} />);
        expect(isPdf(buf)).toBe(true);
    }, 30000);

    it('renders an empty report and a custom template', async () => {
        expect(isPdf(await renderToBuffer(<ReportPDF data={normalizeReportData({})} />))).toBe(true);
        const custom = validateTemplate({
            name: 'FDP', header: { lines: ['Uni', 'School'], title: 'FDP REPORT' },
            sections: [
                { id: 'a', title: 'Basics', fields: [{ id: 'eventName', label: 'Event', type: 'text' }, { id: 'when', label: 'When', type: 'dateRange' }, { id: 'budget', label: 'Budget', type: 'number' }] },
                { id: 'b', title: 'Resource persons', fields: [{ id: 'people', label: 'People', type: 'list', pdfLayout: 'table', subfields: [{ id: 'name', label: 'Name', type: 'text' }, { id: 'org', label: 'Org', type: 'text' }] }] },
                { id: 'c', title: 'Outcome', newPage: true, pdfSubtitle: '{{eventName}} on {{when}}', fields: [{ id: 'outcome', label: 'Outcome', type: 'textarea' }] },
            ],
        });
        expect(custom.errors).toEqual([]);
        const buf = await renderToBuffer(<ReportPDF data={sampleData(custom.template)} template={custom.template} />);
        expect(isPdf(buf)).toBe(true);
    }, 30000);
});

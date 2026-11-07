import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToBuffer } from '@react-pdf/renderer';
import { ReportPDF } from '@/components/ReportPDF';
import { mergeAiValues, sanitizeAiValues } from '@/lib/aiFill';
import { filledCount, missingRequired, sampleData, tableRows, tableTotals, validateTemplate } from '@/lib/template';

const def = (field: Record<string, unknown>) => ({
    name: 'Budget', header: { lines: ['Uni'], title: 'REPORT' },
    sections: [{ id: 'money', title: 'Budget', fields: [field] }],
});

const budget = validateTemplate(def({
    id: 'budget', label: 'Budget', type: 'table', required: true, showTotals: true, rowHeader: 'Head',
    rowLabels: ['Honorarium', 'Refreshments'],
    subfields: [{ id: 'planned', label: 'Planned', type: 'number' }, { id: 'actual', label: 'Actual', type: 'number' }],
}));
const t = budget.template;
const field = t.sections[0].fields[0];

describe('table fields', () => {
    it('validate and keep table options', () => {
        expect(budget.errors).toEqual([]);
        expect(field).toMatchObject({ rowLabels: ['Honorarium', 'Refreshments'], showTotals: true, rowHeader: 'Head' });
    });

    it('reject photo columns and empty tables', () => {
        const bad = validateTemplate(def({ id: 'x', label: 'X', type: 'table', subfields: [{ id: 'p', label: 'P', type: 'image' }] }));
        expect(bad.errors.join()).toMatch(/cannot contain photos/);
        expect(validateTemplate(def({ id: 'x', label: 'X', type: 'table', subfields: [] })).errors.join()).toMatch(/a table needs at least one column/);
    });

    it('always has one row per fixed label, matched by label', () => {
        const rows = tableRows(field, { budget: [{ id: 'a', rowLabel: 'Refreshments', planned: '500' }] });
        expect(rows.map((r) => [r.rowLabel, r.planned])).toEqual([['Honorarium', undefined], ['Refreshments', '500']]);
    });

    it('totals number columns and counts as required', () => {
        const data = { budget: [{ id: 'a', rowLabel: 'Honorarium', planned: '1,000', actual: '900' }, { id: 'b', rowLabel: 'Refreshments', planned: '500' }] };
        expect(tableTotals(field, tableRows(field, data))).toEqual({ planned: '1500', actual: '900' });
        expect(filledCount(field, data)).toBe(2);
        expect(missingRequired(t, {})).toEqual(['Budget: Budget']);
    });

    it('AI fill keeps only known row labels and merges by label', () => {
        const ai = sanitizeAiValues(t, { budget: [{ rowLabel: 'honorarium', planned: '2000' }, { rowLabel: 'Travel', planned: '9' }] });
        expect(ai.budget).toEqual([{ id: 'ai-1', rowLabel: 'Honorarium', planned: '2000' }]);
        const merged = mergeAiValues(t, { budget: [{ id: 'r2', rowLabel: 'Refreshments', planned: '500' }, { id: 'r1', rowLabel: 'Honorarium' }] }, ai, false);
        expect(tableRows(field, merged).map((r) => r.planned)).toEqual(['2000', '500']);
    });

    it('renders in the PDF', async () => {
        const buf = await renderToBuffer(<ReportPDF data={sampleData(t)} template={t} />);
        expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    }, 30000);
});

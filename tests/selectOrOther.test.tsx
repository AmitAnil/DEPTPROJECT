import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SelectOrOther, { OTHER_CHOICE, OTHER_LABEL } from '@/components/template/SelectOrOther';
import { normalizeReportData } from '@/lib/reportData';
import { DEFAULT_TEMPLATE, sectionProblems } from '@/lib/template';

const render = (value: string, options: string[]) =>
    renderToStaticMarkup(<SelectOrOther value={value} options={options} onChange={() => {}} placeholder="Select" selectClassName="" inputClassName="" />);

describe('dropdown with "Others (type your own)"', () => {
    it('offers one typed-answer choice, replacing an existing "Others" option', () => {
        const html = render('', ['Faculty', 'Student', 'Others']);
        expect(html.match(new RegExp(OTHER_LABEL.replace(/[()]/g, '\\$&'), 'g'))).toHaveLength(1);
        expect(html).not.toContain('>Others<');
        expect(html).not.toContain('<input'); // no text box until "Others" is picked
    });

    it('shows a typed answer in a text box with "Others" selected', () => {
        const html = render('Guest lecture series', ['Seminar', 'Workshop']);
        expect(html).toContain(`value="${OTHER_CHOICE}" selected`);
        expect(html).toContain('<input');
        expect(html).toContain('value="Guest lecture series"');
    });

    it('shows a listed answer as a normal selection', () => {
        const html = render('Workshop', ['Seminar', 'Workshop']);
        expect(html).toContain('value="Workshop" selected');
        expect(html).not.toContain('<input');
    });

    it('counts a typed answer as filled in', () => {
        const general = DEFAULT_TEMPLATE.sections[0];
        const data = normalizeReportData({ activityType: 'Hackathon', activityMode: 'Blended' });
        const missing = sectionProblems(general, data).map((p) => p.fieldId);
        expect(missing).not.toContain('activityType');
        expect(missing).not.toContain('activityMode');
    });
});

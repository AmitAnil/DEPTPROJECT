import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATE, type ReportTemplate } from '@/lib/template';
import { describeSkipped, renderWithFallback } from '@/lib/previewFallback';

/** A fake renderer that fails whenever the template still contains one of the given field ids. */
const failingOn = (...ids: string[]) => async (t: ReportTemplate) => {
    const present = t.sections.flatMap((s) => s.fields.map((f) => f.id));
    if (ids.some((id) => present.includes(id))) throw new Error('unsupported number: -1.44e+22');
    return present;
};

describe('preview fallback', () => {
    it('renders normally when everything can be drawn', async () => {
        const r = await renderWithFallback(DEFAULT_TEMPLATE, failingOn());
        expect(r.skipped).toEqual([]);
        expect(r.error).toBeUndefined();
    });

    it('leaves out only the field that cannot be drawn and names it', async () => {
        const r = await renderWithFallback(DEFAULT_TEMPLATE, failingOn('venue'));
        expect(r.skipped).toEqual([{ section: 'General Information', field: 'Venue' }]);
        expect(r.output).not.toContain('venue');
        expect(r.output).toContain('activityTitle');
        expect(r.output).toContain('summary');
        expect(r.error).toContain('unsupported number');
        expect(describeSkipped(r.skipped)).toBe('General Information → Venue');
    });

    it('handles problems in several sections', async () => {
        const r = await renderWithFallback(DEFAULT_TEMPLATE, failingOn('venue', 'activityPhotos'));
        expect(describeSkipped(r.skipped)).toBe('General Information → Venue, Activity Photos → Upload Photos');
    });

    it('leaves out a whole section when only the combination fails', async () => {
        const render = async (t: ReportTemplate) => {
            const ids = t.sections.flatMap((s) => s.fields.map((f) => f.id));
            if (ids.includes('highlights') && ids.includes('takeaways')) throw new Error('boom');
            return ids;
        };
        const r = await renderWithFallback(DEFAULT_TEMPLATE, render);
        expect(r.skipped).toEqual([{ section: 'Synopsis' }]);
    });

    it('gives up when even an empty report fails', async () => {
        await expect(renderWithFallback(DEFAULT_TEMPLATE, async () => { throw new Error('header broken'); })).rejects.toThrow('header broken');
    });
});

import { describe, expect, it } from 'vitest';
import { normalizeReportData } from '@/lib/reportData';

describe('normalizeReportData', () => {
    it('returns a complete empty report for junk input', () => {
        const data = normalizeReportData(null);
        expect(data.activityTitle).toBe('');
        expect(data.participantProfiles).toHaveLength(3);
        expect(data.speakers).toHaveLength(1);
        expect(data.attendanceFiles).toEqual([]);
    });

    it('prefers counts typed into the legacy participantsProfile key', () => {
        const data = normalizeReportData({
            participantProfiles: [{ id: 1, type: 'Student', count: '' }],
            participantsProfile: [{ id: 9, type: 'Student', count: '42' }],
        });
        expect(data.participantProfiles).toEqual([{ id: 9, type: 'Student', count: '42' }]);
    });

    it('upgrades legacy speaker and synopsis keys', () => {
        const data = normalizeReportData({
            speakers: [{ id: 1, name: 'Dr. A', title: 'Professor', presentation: 'Talk', photoUrl: 'sb://reports/x.png' }],
            followUp: 'Next steps',
        });
        expect(data.speakers[0]).toMatchObject({ designation: 'Professor', presentationTitle: 'Talk', photo: 'sb://reports/x.png' });
        expect(data.followUpPlan).toBe('Next steps');
    });

    it('turns legacy {url} image uploads into renderable pages', () => {
        const data = normalizeReportData({
            brochureFiles: [{ id: '1', name: 'flyer.png', type: 'image/png', url: 'https://proj.supabase.co/storage/v1/object/public/reports/flyer.png' }],
        });
        expect(data.brochureFiles[0].pages).toHaveLength(1);
        expect(data.brochureFiles[0].type).toBe('png');
        expect(data.brochureFiles[0].source).toContain('flyer.png');
    });

    it('migrates the flat "prepared by" fields', () => {
        const data = normalizeReportData({ preparedByName: 'Jane', preparedByDesignation: 'Asst. Prof' });
        expect(data.organizersList[0]).toMatchObject({ name: 'Jane', designation: 'Asst. Prof' });
    });

    it('keeps the drive link', () => {
        expect(normalizeReportData({ drive_link: 'https://drive' }).drive_link).toBe('https://drive');
    });
});

describe('custom template fields', () => {
    it('keeps values of fields that are not built in', () => {
        const data = normalizeReportData({ chiefGuest: 'Dr. X', budget: '5000', participantsProfile: [] });
        expect(data.chiefGuest).toBe('Dr. X');
        expect(data.budget).toBe('5000');
        expect('participantsProfile' in data).toBe(false);
    });
});

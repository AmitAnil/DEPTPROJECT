import { describe, expect, it } from 'vitest';
import { archiveFileName, archivedPdfId, driveIdFromLink, filterArchive, sortArchive, toArchivedReport, type ArchivedReport } from '@/lib/archive';

describe('finding the archived PDF in Drive', () => {
    it('reads file and folder ids from Drive links', () => {
        expect(driveIdFromLink('https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view?usp=drivesdk')).toBe('1AbCdEfGhIjKlMn');
        expect(driveIdFromLink('https://drive.google.com/drive/folders/1FoLdEr_Id-123')).toBe('1FoLdEr_Id-123');
        expect(driveIdFromLink('https://drive.google.com/open?id=1OpenStyleId99')).toBe('1OpenStyleId99');
        expect(driveIdFromLink('not a link')).toBeNull();
        expect(driveIdFromLink(undefined)).toBeNull();
    });

    it('prefers the stored id, then the PDF link, then an old-style direct PDF link', () => {
        expect(archivedPdfId({ drive_pdf_id: 'stored-id-1234', drive_pdf_link: 'https://drive.google.com/file/d/other-id-9999/view' })).toBe('stored-id-1234');
        expect(archivedPdfId({ drive_pdf_link: 'https://drive.google.com/file/d/fromLink12345/view' })).toBe('fromLink12345');
        expect(archivedPdfId({ drive_link: 'https://drive.google.com/file/d/legacyPdf1234/view' })).toBe('legacyPdf1234');
        // A folder link alone is not a PDF.
        expect(archivedPdfId({ drive_link: 'https://drive.google.com/drive/folders/folderOnly123' })).toBeNull();
        expect(archivedPdfId({})).toBeNull();
    });
});

describe('archive list', () => {
    const row = (id: string, data: Record<string, unknown>, updated = '2026-11-20T10:00:00Z', title: string | null = null) =>
        toArchivedReport({ id, title, data, updated_at: updated, profiles: [{ full_name: 'Asha Rao' }] });

    it('shows only list details, never the report contents or Drive links', () => {
        const r = row('r1', {
            activityTitle: 'AI Workshop', date: '2026-11-10', activityType: 'Workshop', venue: 'Seminar Hall',
            summary: 'private text', drive_pdf_id: 'pdf-id-123456',
        });
        expect(r).toEqual({
            id: 'r1', title: 'AI Workshop', eventDate: '2026-11-10', activityType: 'Workshop', venue: 'Seminar Hall',
            organizer: 'Asha Rao', approvedAt: '2026-11-20T10:00:00Z', hasPdf: true,
        });
        expect(JSON.stringify(r)).not.toContain('private text');
        expect(JSON.stringify(r)).not.toContain('pdf-id');
    });

    it('marks reports approved without Drive as having no PDF', () => {
        expect(row('r2', { activityTitle: 'Old' }).hasPdf).toBe(false);
    });

    const items: ArchivedReport[] = [
        { id: 'a', title: 'Hackathon', eventDate: '2025-08-01', activityType: 'Competition', venue: 'Lab', organizer: 'Ravi', approvedAt: '2025-08-05T00:00:00Z', hasPdf: true },
        { id: 'b', title: 'AI Workshop', eventDate: '2026-11-10', activityType: 'Workshop', venue: 'Seminar Hall', organizer: 'Asha', approvedAt: '2026-11-12T00:00:00Z', hasPdf: true },
        { id: 'c', title: 'No date talk', eventDate: null, activityType: 'Guest Lecture', venue: null, organizer: null, approvedAt: '2026-01-02T00:00:00Z', hasPdf: false },
    ];

    it('lists the newest events first', () => {
        expect(sortArchive(items).map((r) => r.id)).toEqual(['b', 'c', 'a']);
    });

    it('searches title, venue and organizer, and filters by type and year', () => {
        expect(filterArchive(items, { query: 'seminar' }).map((r) => r.id)).toEqual(['b']);
        expect(filterArchive(items, { query: 'RAVI' }).map((r) => r.id)).toEqual(['a']);
        expect(filterArchive(items, { type: 'Workshop' }).map((r) => r.id)).toEqual(['b']);
        expect(filterArchive(items, { year: '2026' }).map((r) => r.id)).toEqual(['b', 'c']);
        expect(filterArchive(items, { query: 'talk', year: '2025' })).toEqual([]);
    });

    it('builds a safe download file name', () => {
        expect(archiveFileName({ title: 'AI / ML: "Intro"?', eventDate: '2026-11-10' })).toBe('2026-11-10 AI ML Intro.pdf');
        expect(archiveFileName({ title: 'Talk', eventDate: null })).toBe('Talk.pdf');
    });
});

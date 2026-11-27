import { afterEach, describe, expect, it, vi } from 'vitest';
import type { drive_v3 } from '@googleapis/drive';
import { DEFAULT_TEMPLATE } from '@/lib/template';
import { normalizeReportData } from '@/lib/reportData';
import { collectOriginalFiles, mimeFor } from '@/lib/archiveFiles';
import { archiveRootFolder, describeDriveError, driveMode, driveSafeName, resetArchiveFolderCache } from '@/lib/drive';

const ENV_KEYS = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN', 'GOOGLE_SERVICE_ACCOUNT_KEY', 'GOOGLE_DRIVE_FOLDER_ID', 'GOOGLE_DRIVE_FOLDER_NAME'];
afterEach(() => { for (const k of ENV_KEYS) delete process.env[k]; resetArchiveFolderCache(); });

describe('which Drive setup is used', () => {
    it('is off until something is configured', () => {
        expect(driveMode()).toBeNull();
    });
    it('uses the Google account sign-in when its three settings are present', () => {
        Object.assign(process.env, { GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'secret', GOOGLE_OAUTH_REFRESH_TOKEN: 'token' });
        expect(driveMode()).toBe('account');
    });
    it('falls back to a service account with a Shared Drive folder', () => {
        Object.assign(process.env, { GOOGLE_SERVICE_ACCOUNT_KEY: '{}', GOOGLE_DRIVE_FOLDER_ID: 'folder' });
        expect(driveMode()).toBe('service');
    });
    it('ignores an incomplete account setup', () => {
        Object.assign(process.env, { GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_REFRESH_TOKEN: 'token' });
        expect(driveMode()).toBeNull();
    });
});

describe('archive folder in My Drive', () => {
    const fakeDrive = (existing: string | null) => {
        const list = vi.fn(async () => ({ data: { files: existing ? [{ id: existing }] : [] } }));
        const create = vi.fn(async () => ({ data: { id: 'new-folder' } }));
        return { drive: { files: { list, create } } as unknown as drive_v3.Drive, list, create };
    };

    it('creates "DeptDocs Approved Reports" once and reuses it', async () => {
        process.env.GOOGLE_OAUTH_CLIENT_ID = 'id';
        const f = fakeDrive(null);
        expect(await archiveRootFolder(f.drive, 'account')).toBe('new-folder');
        expect(f.create).toHaveBeenCalledWith(expect.objectContaining({ requestBody: expect.objectContaining({ name: 'DeptDocs Approved Reports' }) }));
        expect(await archiveRootFolder(f.drive, 'account')).toBe('new-folder');
        expect(f.list).toHaveBeenCalledTimes(1);
    });

    it('finds an existing folder and accepts a custom name', async () => {
        process.env.GOOGLE_DRIVE_FOLDER_NAME = "Dept's Reports";
        const f = fakeDrive('existing');
        expect(await archiveRootFolder(f.drive, 'account')).toBe('existing');
        expect(f.create).not.toHaveBeenCalled();
        expect((f.list.mock.calls[0] as unknown as [{ q: string }])[0].q).toContain("name = 'Dept\\'s Reports'");
    });

    it('uses the configured Shared Drive folder for a service account', async () => {
        process.env.GOOGLE_DRIVE_FOLDER_ID = 'shared-folder';
        const f = fakeDrive(null);
        expect(await archiveRootFolder(f.drive, 'service')).toBe('shared-folder');
        expect(f.list).not.toHaveBeenCalled();
    });
});

describe('original files of a report', () => {
    const data = normalizeReportData({
        speakers: [
            { id: 's1', name: 'Dr. Asha', designation: 'P', organization: 'O', contact: 'c', presentationTitle: 't', about: 'a', photo: 'sb://reports/r1/speakers/asha.JPG' },
            { id: 's2', name: '', photo: '' },
        ],
        activityPhotos: [{ id: 'p1', url: 'sb://reports/r1/photos/a.jpg' }, { id: 'p2', url: 'sb://reports/r1/photos/b.png' }],
        approvalFiles: [{ id: 'f1', name: 'NFA signed.pdf', type: 'pdf', source: 'sb://reports/r1/approvalFiles/x.pdf', pages: [] }],
        attendanceFiles: [{ id: 'f2', name: 'attendance', type: 'xlsx', source: 'sb://reports/r1/attendanceFiles/y.xlsx', pages: [] },
            { id: 'f3', name: 'old upload', type: 'pdf', pages: ['sb://reports/r1/pages/1.jpg'] }],
        brochureFiles: [{ id: 'f4', name: 'dup.pdf', type: 'pdf', source: 'sb://reports/r1/approvalFiles/x.pdf', pages: [] }],
    });

    it('lists uploads by section, photos and speaker pictures, each once, with extensions', () => {
        expect(collectOriginalFiles(DEFAULT_TEMPLATE, data)).toEqual([
            { ref: 'sb://reports/r1/speakers/asha.JPG', name: 'Speaker Photo - Dr. Asha.jpg' },
            { ref: 'sb://reports/r1/photos/a.jpg', name: 'Photo 1.jpg' },
            { ref: 'sb://reports/r1/photos/b.png', name: 'Photo 2.png' },
            { ref: 'sb://reports/r1/attendanceFiles/y.xlsx', name: 'Attendance List - attendance.xlsx' },
            // Brochure comes before the NFA in the format; the same stored file is listed once.
            { ref: 'sb://reports/r1/approvalFiles/x.pdf', name: 'Brochure - dup.pdf' },
        ]);
    });

    it('knows common content types', () => {
        expect(mimeFor('a.PDF')).toBe('application/pdf');
        expect(mimeFor('a.xlsx')).toContain('spreadsheetml');
        expect(mimeFor('noext')).toBe('application/octet-stream');
    });
});

describe('names and errors', () => {
    it('makes names safe for Drive', () => {
        expect(driveSafeName('  AI / ML\\Workshop\n2026 ')).toBe('AI ML Workshop 2026');
        expect(driveSafeName('')).toBe('Untitled');
    });
    it('explains common failures in plain words', () => {
        expect(describeDriveError(new Error('invalid_grant'))).toMatch(/refresh token/);
        expect(describeDriveError(new Error('invalid_client'))).toMatch(/client ID or secret/);
        expect(describeDriveError(new Error('The user does not have sufficient storage quota'))).toMatch(/full/);
        expect(describeDriveError(new Error('something else'))).toBe('something else');
    });
});

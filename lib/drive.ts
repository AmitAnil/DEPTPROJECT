// SERVER ONLY: Google Drive access for archiving approved reports.
import { Readable } from 'node:stream';
import { auth as googleAuth, drive as googleDrive, type drive_v3 } from '@googleapis/drive';

/**
 * Two ways to reach Drive:
 * - "account": a normal Google account (e.g. a Gmail address) that allowed DeptDocs once;
 *   needs GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REFRESH_TOKEN.
 *   Files go to that account's My Drive, in a folder DeptDocs creates.
 * - "service": a service account uploading into a Shared Drive folder;
 *   needs GOOGLE_SERVICE_ACCOUNT_KEY and GOOGLE_DRIVE_FOLDER_ID.
 */
export type DriveMode = 'account' | 'service';

const env = (k: string) => process.env[k]?.trim() || '';

export function driveMode(): DriveMode | null {
    if (env('GOOGLE_OAUTH_CLIENT_ID') && env('GOOGLE_OAUTH_CLIENT_SECRET') && env('GOOGLE_OAUTH_REFRESH_TOKEN')) return 'account';
    if (env('GOOGLE_SERVICE_ACCOUNT_KEY') && env('GOOGLE_DRIVE_FOLDER_ID')) return 'service';
    return null;
}

/** Name of the folder DeptDocs creates in the account's My Drive ("account" mode). */
export const archiveFolderName = () => env('GOOGLE_DRIVE_FOLDER_NAME') || 'DeptDocs Approved Reports';

// Only files and folders created by DeptDocs are visible to it; nothing else in the Drive.
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const FOLDER = 'application/vnd.google-apps.folder';

export function createDriveClient(mode: DriveMode): drive_v3.Drive {
    if (mode === 'account') {
        const client = new googleAuth.OAuth2(env('GOOGLE_OAUTH_CLIENT_ID'), env('GOOGLE_OAUTH_CLIENT_SECRET'));
        client.setCredentials({ refresh_token: env('GOOGLE_OAUTH_REFRESH_TOKEN') });
        return googleDrive({ version: 'v3', auth: client });
    }
    const auth = new googleAuth.GoogleAuth({ credentials: JSON.parse(env('GOOGLE_SERVICE_ACCOUNT_KEY')), scopes: SCOPES });
    return googleDrive({ version: 'v3', auth });
}

/** Drive names: no slashes or control characters, reasonable length. */
export function driveSafeName(name: string, max = 120): string {
    const cleaned = name.replace(/[\u0000-\u001f/\\]+/g, ' ').replace(/\s+/g, ' ').trim();
    return (cleaned || 'Untitled').slice(0, max).trim();
}

const escapeQuery = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

let cachedRoot: { key: string; id: string } | null = null;

/** The folder that holds one sub-folder per approved report. */
export async function archiveRootFolder(drive: drive_v3.Drive, mode: DriveMode): Promise<string> {
    if (mode === 'service') return env('GOOGLE_DRIVE_FOLDER_ID');
    const name = archiveFolderName();
    const key = `${env('GOOGLE_OAUTH_CLIENT_ID')}|${name}`;
    if (cachedRoot?.key === key) return cachedRoot.id;
    const found = await drive.files.list({
        q: `mimeType = '${FOLDER}' and name = '${escapeQuery(name)}' and 'root' in parents and trashed = false`,
        fields: 'files(id)', pageSize: 1, spaces: 'drive',
    });
    let id = found.data.files?.[0]?.id ?? null;
    if (!id) {
        const created = await drive.files.create({ requestBody: { name, mimeType: FOLDER, parents: ['root'] }, fields: 'id' });
        id = created.data.id ?? null;
    }
    if (!id) throw new Error('Could not create the archive folder in Google Drive.');
    cachedRoot = { key, id };
    return id;
}

/** Forget the cached archive folder (e.g. after it was deleted in Drive). */
export const resetArchiveFolderCache = () => { cachedRoot = null; };

export interface DriveItem {
    id: string;
    link: string;
}

export async function createDriveFolder(drive: drive_v3.Drive, name: string, parent: string): Promise<DriveItem> {
    const res = await drive.files.create({
        requestBody: { name: driveSafeName(name), mimeType: FOLDER, parents: [parent] },
        fields: 'id, webViewLink',
        supportsAllDrives: true,
    });
    if (!res.data.id || !res.data.webViewLink) throw new Error('Google Drive did not return the new folder.');
    return { id: res.data.id, link: res.data.webViewLink };
}

export async function uploadToDrive(drive: drive_v3.Drive, parent: string, name: string, mimeType: string, data: Buffer): Promise<DriveItem> {
    const res = await drive.files.create({
        requestBody: { name: driveSafeName(name, 200), parents: [parent] },
        media: { mimeType, body: Readable.from(data) },
        fields: 'id, webViewLink',
        supportsAllDrives: true, // needed when the folder is in a Shared Drive
    });
    if (!res.data.id || !res.data.webViewLink) throw new Error(`Google Drive did not return a link for "${name}".`);
    return { id: res.data.id, link: res.data.webViewLink };
}

/** A clearer message for common Drive failures. */
export function describeDriveError(error: unknown): string {
    const msg = error instanceof Error ? error.message : String(error);
    if (/invalid_grant/i.test(msg)) {
        return 'Google Drive access has expired or was removed. Create a new refresh token (see the Drive setup steps) and put it in GOOGLE_OAUTH_REFRESH_TOKEN.';
    }
    if (/invalid_client|unauthorized_client/i.test(msg)) {
        return 'The Google OAuth client ID or secret is wrong. Check GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.';
    }
    if (/storage quota|storageQuotaExceeded/i.test(msg)) {
        return 'Google Drive is full or the account has no storage (service accounts need a Shared Drive folder).';
    }
    if (/File not found|notFound/i.test(msg)) {
        return 'The Google Drive folder could not be found or DeptDocs has no access to it.';
    }
    return msg;
}

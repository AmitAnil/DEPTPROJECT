import { NextResponse } from 'next/server';
import { getAuthContext, unauthorized } from '@/lib/auth';
import { archiveFileName, archivedPdfId, toArchivedReport } from '@/lib/archive';
import { createDriveClient, describeDriveError, driveMode } from '@/lib/drive';
import { createAdminClient } from '@/utils/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Streams the archived PDF of an approved report from Google Drive to a signed-in user, so the
 * Drive folder itself can stay private. `?download=1` saves it instead of opening it.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

    const { data: report } = await createAdminClient()
        .from('reports').select('id, title, data, updated_at, status').eq('id', id).maybeSingle();
    // Only approved reports are in the archive.
    if (!report || report.status !== 'approved') return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

    const fileId = archivedPdfId(report.data as Record<string, unknown>);
    const mode = driveMode();
    if (!fileId) return NextResponse.json({ error: 'This report has no archived PDF.' }, { status: 404 });
    if (!mode) return NextResponse.json({ error: 'Google Drive is not set up on this server.' }, { status: 503 });

    try {
        const drive = createDriveClient(mode);
        const res = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
        const body = Buffer.from(res.data as ArrayBuffer);
        const name = archiveFileName(toArchivedReport(report));
        const download = new URL(req.url).searchParams.get('download') === '1';
        return new NextResponse(body, {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Length': String(body.length),
                'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
                'Cache-Control': 'private, no-store',
                'X-Content-Type-Options': 'nosniff',
            },
        });
    } catch (error) {
        console.error('Archive PDF failed:', error);
        return NextResponse.json({ error: describeDriveError(error) }, { status: 502 });
    }
}

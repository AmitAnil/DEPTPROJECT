import { Readable } from 'node:stream';
import React from 'react';
import { NextResponse } from 'next/server';
import { auth as googleAuth, drive as googleDrive } from '@googleapis/drive';
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import { ReportPDF } from '@/components/ReportPDF';
import { forbidden, getAuthContext, unauthorized } from '@/lib/auth';
import { normalizeReportData } from '@/lib/reportData';
import { isPathAllowedForReport, resolveStorageRefs, scopedSigner } from '@/lib/storage';
import { loadTemplate } from '@/lib/templateStore';
import { dispatchNotificationEmails } from '@/lib/notificationDispatch';
import { createAdminClient, createServiceSigner } from '@/utils/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Admin only: renders a submitted report to PDF, archives it in Google Drive and
 * marks it as approved.
 */
export async function POST(req: Request) {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();
    if (!ctx.isAdmin) return forbidden();

    let reportId: unknown;
    try {
        ({ reportId } = await req.json());
    } catch {
        return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }
    if (typeof reportId !== 'string' || !UUID.test(reportId)) {
        return NextResponse.json({ error: 'Missing or invalid reportId.' }, { status: 400 });
    }

    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!folderId || !serviceAccountJson) {
        return NextResponse.json({ error: 'Google Drive is not configured on this server.' }, { status: 503 });
    }

    try {
        const admin = createAdminClient();

        const { data: report, error: dbError } = await admin
            .from('reports')
            .select('id, title, status, owner_id, data, template_id, profiles!reports_owner_id_fkey(full_name)')
            .eq('id', reportId)
            .single();
        if (dbError || !report) {
            return NextResponse.json({ error: 'Report not found.' }, { status: 404 });
        }
        if (report.status !== 'completed') {
            return NextResponse.json({ error: `Only submitted reports can be approved (this one is "${report.status}").` }, { status: 409 });
        }

        // 1. Render the PDF (in the report's own template version) with short-lived signed URLs for every image.
        const { definition: template } = await loadTemplate(admin, report.template_id);
        // Only files that belong to this report or its members may be signed (see isPathAllowedForReport).
        const { data: collabs, error: collabError } = await admin.from('collaborators').select('user_id').eq('report_id', report.id).eq('status', 'accepted');
        if (collabError) {
            // Without the member list collaborators' files would be silently left out of the archived PDF.
            throw new Error(`Could not load the report's collaborators: ${collabError.message}`);
        }
        const memberIds = [report.owner_id as string, ...((collabs ?? []).map((c) => c.user_id as string))];
        const signer = scopedSigner(createServiceSigner(admin), (bucket, path) => isPathAllowedForReport(bucket, path, report.id, memberIds));
        const reportData = await resolveStorageRefs(normalizeReportData(report.data), signer);
        const element = React.createElement(ReportPDF, { data: reportData, template }) as unknown as React.ReactElement<DocumentProps>;
        const pdfBuffer = await renderToBuffer(element);

        // 2. Upload to Google Drive with the service account.
        const authClient = new googleAuth.GoogleAuth({
            credentials: JSON.parse(serviceAccountJson),
            scopes: ['https://www.googleapis.com/auth/drive.file'],
        });
        const drive = googleDrive({ version: 'v3', auth: authClient });

        const owner = Array.isArray(report.profiles) ? report.profiles[0] : report.profiles;
        const safeTitle = (report.title || 'Report').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 80);
        const safeOwner = (owner?.full_name || '').replace(/[^a-zA-Z0-9]+/g, '');
        const fileName = `${safeTitle}${safeOwner ? `_${safeOwner}` : ''}.pdf`;

        const driveResponse = await drive.files.create({
            requestBody: { name: fileName, parents: [folderId] },
            media: { mimeType: 'application/pdf', body: Readable.from(pdfBuffer) },
            fields: 'id, webViewLink',
            supportsAllDrives: true, // required when the folder lives in a Shared Drive
        });
        const link = driveResponse.data.webViewLink;
        if (!link) throw new Error('Google Drive did not return a link for the uploaded file.');

        // 3. Mark as approved. The status filter makes a double click harmless.
        const storedData = report.data && typeof report.data === 'object' ? report.data : {};
        const { data: updated, error: updateError } = await admin
            .from('reports')
            .update({
                status: 'approved',
                admin_feedback: null,
                data: { ...storedData, drive_link: link },
                updated_at: new Date().toISOString(),
            })
            .eq('id', reportId)
            .eq('status', 'completed')
            .select('id');
        if (updateError) {
            throw new Error(`Uploaded to Drive but could not update the report: ${updateError.message}. Has the database migration been applied?`);
        }

        if (updated && updated.length > 0) {
            // The owner's notification is created by a database trigger; email it now.
            await dispatchNotificationEmails(admin).catch((e) => console.error('Email dispatch failed:', e));
            await admin.from('activity_logs').insert({
                user_id: ctx.user.id,
                user_name: ctx.user.email,
                action_type: 'REPORT_APPROVED',
                description: `approved "${report.title}"`,
                target_id: report.id,
            });
        }

        return NextResponse.json({ success: true, fileId: driveResponse.data.id, link });
    } catch (error) {
        console.error('Drive approve error:', error);
        const message = error instanceof Error ? error.message : 'Failed to archive the report in Google Drive.';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

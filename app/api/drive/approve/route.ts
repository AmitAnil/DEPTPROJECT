import React from 'react';
import { NextResponse } from 'next/server';
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import { ReportPDF } from '@/components/ReportPDF';
import { forbidden, getAuthContext, unauthorized } from '@/lib/auth';
import { normalizeReportData } from '@/lib/reportData';
import { isPathAllowedForReport, parseStorageRef, resolveStorageRefs, scopedSigner } from '@/lib/storage';
import { allFields } from '@/lib/template';
import { collectOriginalFiles, mimeFor } from '@/lib/archiveFiles';
import { archiveRootFolder, createDriveClient, createDriveFolder, describeDriveError, driveMode, driveSafeName, uploadToDrive } from '@/lib/drive';
import { loadTemplate } from '@/lib/templateStore';
import { dispatchNotificationEmails } from '@/lib/notificationDispatch';
import { createAdminClient, createServiceSigner } from '@/utils/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Admin only: renders a submitted report to PDF, archives it in Google Drive (a folder per
 * report with the PDF and the original uploads) and marks it as approved.
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

    const mode = driveMode();
    if (!mode) {
        return NextResponse.json({ error: 'Google Drive is not set up on this server yet (see the Drive setup steps).' }, { status: 503 });
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
        const { definition: template } = await loadTemplate(admin, report.template_id, { strict: true });
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

        // 2. Archive in Google Drive: <archive folder>/<date> <title> (<owner>)/ with the PDF and the originals.
        const drive = createDriveClient(mode);
        const owner = Array.isArray(report.profiles) ? report.profiles[0] : report.profiles;
        const title = driveSafeName(report.title || 'Report', 100);
        const dateField = allFields(template).find((f) => f.type === 'dateRange' || f.type === 'date');
        const eventDate = dateField && typeof reportData[dateField.id] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(reportData[dateField.id] as string)
            ? reportData[dateField.id] as string
            : new Date().toISOString().slice(0, 10);
        const root = await archiveRootFolder(drive, mode);
        const folder = await createDriveFolder(drive, `${eventDate} ${title}${owner?.full_name ? ` (${owner.full_name})` : ''}`, root);
        const pdfFile = await uploadToDrive(drive, folder.id, `${title}.pdf`, 'application/pdf', Buffer.from(pdfBuffer));

        // Originals: only files that belong to this report or its members; a failure skips that file.
        const missed: string[] = [];
        for (const original of collectOriginalFiles(template, normalizeReportData(report.data))) {
            try {
                const loc = parseStorageRef(original.ref);
                if (!loc || !isPathAllowedForReport(loc.bucket, loc.path, report.id, memberIds)) throw new Error('not part of this report');
                const { data: blob, error: downloadError } = await admin.storage.from(loc.bucket).download(loc.path);
                if (downloadError || !blob) throw new Error(downloadError?.message ?? 'download failed');
                await uploadToDrive(drive, folder.id, original.name, blob.type || mimeFor(original.name), Buffer.from(await blob.arrayBuffer()));
            } catch (fileError) {
                console.error(`Could not copy "${original.name}" to Drive:`, fileError);
                missed.push(original.name);
            }
        }
        const link = folder.link;

        // 3. Mark as approved. The status filter makes a double click harmless.
        const storedData = report.data && typeof report.data === 'object' ? report.data : {};
        const { data: updated, error: updateError } = await admin
            .from('reports')
            .update({
                status: 'approved',
                admin_feedback: null,
                data: { ...storedData, drive_link: link, drive_pdf_link: pdfFile.link, drive_folder_id: folder.id, drive_pdf_id: pdfFile.id },
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

        return NextResponse.json({ success: true, link, pdfLink: pdfFile.link, missed });
    } catch (error) {
        console.error('Drive approve error:', error);
        return NextResponse.json({ error: describeDriveError(error) || 'Failed to archive the report in Google Drive.' }, { status: 500 });
    }
}

/** Approved reports as listed in the archive (safe to send to any signed-in user). */
export interface ArchivedReport {
    id: string;
    title: string;
    /** Event date (YYYY-MM-DD) when the report has one. */
    eventDate: string | null;
    activityType: string | null;
    venue: string | null;
    organizer: string | null;
    approvedAt: string;
    /** Whether the PDF can be opened (it was archived in Google Drive). */
    hasPdf: boolean;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const isoDate = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** The Drive file id in a link such as https://drive.google.com/file/d/<id>/view or .../folders/<id>. */
export function driveIdFromLink(link: unknown): string | null {
    if (typeof link !== 'string') return null;
    const m = /\/(?:file\/d|folders)\/([A-Za-z0-9_-]{10,})/.exec(link) ?? /[?&]id=([A-Za-z0-9_-]{10,})/.exec(link);
    return m ? m[1] : null;
}

/** Drive id of a report's archived PDF (stored id, or recovered from the stored link for older approvals). */
export function archivedPdfId(data: Record<string, unknown> | null | undefined): string | null {
    if (!data) return null;
    return str(data.drive_pdf_id) ?? driveIdFromLink(data.drive_pdf_link)
        // Before folders, drive_link pointed straight at the PDF file.
        ?? (typeof data.drive_link === 'string' && data.drive_link.includes('/file/d/') ? driveIdFromLink(data.drive_link) : null);
}

interface ReportRow {
    id: string;
    title: string | null;
    data: Record<string, unknown> | null;
    updated_at: string;
    profiles?: { full_name: string | null } | { full_name: string | null }[] | null;
}

/** One archive entry from a stored approved report. */
export function toArchivedReport(row: ReportRow): ArchivedReport {
    const d = row.data ?? {};
    const owner = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
        id: row.id,
        title: str(row.title) ?? str(d.activityTitle) ?? 'Untitled report',
        eventDate: isoDate(d.date) ?? isoDate(d.eventDate),
        activityType: str(d.activityType),
        venue: str(d.venue),
        organizer: owner?.full_name ?? null,
        approvedAt: row.updated_at,
        hasPdf: archivedPdfId(d) !== null,
    };
}

/** Newest event first; reports without an event date by approval time. */
export function sortArchive(items: ArchivedReport[]): ArchivedReport[] {
    const key = (r: ArchivedReport) => r.eventDate ?? r.approvedAt.slice(0, 10);
    return [...items].sort((a, b) => key(b).localeCompare(key(a)) || b.approvedAt.localeCompare(a.approvedAt));
}

/** Case-insensitive search over title, type, venue and organizer, plus optional type and year filters. */
export function filterArchive(items: ArchivedReport[], opts: { query?: string; type?: string; year?: string }): ArchivedReport[] {
    const q = (opts.query ?? '').trim().toLowerCase();
    return items.filter((r) => {
        if (opts.type && r.activityType !== opts.type) return false;
        if (opts.year && (r.eventDate ?? r.approvedAt).slice(0, 4) !== opts.year) return false;
        if (!q) return true;
        return [r.title, r.activityType, r.venue, r.organizer].some((v) => v?.toLowerCase().includes(q));
    });
}

/** File name for a downloaded PDF. */
export const archiveFileName = (r: Pick<ArchivedReport, 'title' | 'eventDate'>) =>
    `${r.eventDate ? `${r.eventDate} ` : ''}${r.title}`.replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) + '.pdf';

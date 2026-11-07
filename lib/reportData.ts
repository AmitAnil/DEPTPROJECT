// Types and normalisation for the JSONB `reports.data` payload.
//
// Older reports were saved with a few inconsistent keys (e.g. `participantsProfile`,
// `followUp`, speaker `photoUrl`, attachment files saved as `{ url }` with no `pages`).
// `normalizeReportData` upgrades any of those shapes to the current one so the editor,
// live preview and server-side PDF all read the same fields.

export type ReportStatus = 'draft' | 'completed' | 'approved';

export interface Speaker {
    id: number | string;
    name: string;
    designation: string;
    organization: string;
    contact: string;
    presentationTitle: string;
    about: string;
    /** Storage ref (sb://...), legacy URL or data URL. */
    photo: string | null;
}

export interface ParticipantGroup {
    id: number | string;
    type: string;
    count: string;
}

export interface Organizer {
    name: string;
    designation: string;
    /** Storage ref (sb://signatures/...) or legacy URL. */
    signatureImage: string;
}

export interface ActivityPhoto {
    id: string;
    /** Storage ref (sb://reports/...), legacy URL or data URL. */
    url: string;
    caption: string;
}

export type SpreadsheetRow = Record<string, string | number | boolean | null>;

export interface AttachmentFile {
    id: string;
    name: string;
    /** File extension, e.g. "pdf", "png", "xlsx". */
    type: string;
    /** Storage ref of the original upload (used for AI extraction). */
    source?: string;
    /** One image per page, rendered into the PDF report. */
    pages: string[];
    /** Parsed rows for spreadsheets. */
    jsonData?: SpreadsheetRow[] | null;
}

export const ATTACHMENT_KEYS = ['attendanceFiles', 'brochureFiles', 'approvalFiles', 'feedbackFiles'] as const;
export type AttachmentKey = (typeof ATTACHMENT_KEYS)[number];

export interface ReportData {
    activityTitle: string;
    activityType: string;
    subCategory: string;
    venue: string;
    collaboration: string;
    date: string;
    time: string;
    endDate: string;
    endTime: string;
    speakers: Speaker[];
    participantProfiles: ParticipantGroup[];
    highlights: string;
    takeaways: string;
    summary: string;
    followUpPlan: string;
    organizersList: Organizer[];
    useProfile: boolean;
    useCollaborators: boolean;
    activityPhotos: ActivityPhoto[];
    attendanceFiles: AttachmentFile[];
    brochureFiles: AttachmentFile[];
    approvalFiles: AttachmentFile[];
    feedbackFiles: AttachmentFile[];
    /** Set by the server when an admin approves and archives the report. */
    drive_link?: string;
}

export interface ReportRow {
    id: string;
    title: string;
    status: ReportStatus;
    owner_id: string;
    updated_at: string;
    data: unknown;
    admin_feedback?: string | null;
}

let idCounter = 0;
/** Unique-enough id for list items created in the browser. */
export function newItemId(): string {
    idCounter += 1;
    return `${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createEmptySpeaker(id: string | number = newItemId()): Speaker {
    return { id, name: '', designation: '', organization: '', contact: '', presentationTitle: '', about: '', photo: null };
}

export function createDefaultParticipants(): ParticipantGroup[] {
    return [
        { id: 1, type: 'Student', count: '' },
        { id: 2, type: 'Faculty', count: '' },
        { id: 3, type: 'Research Scholar', count: '' },
    ];
}

export function createEmptyReportData(): ReportData {
    return {
        activityTitle: '',
        activityType: '',
        subCategory: '',
        venue: '',
        collaboration: '',
        date: '',
        time: '',
        endDate: '',
        endTime: '',
        speakers: [createEmptySpeaker('speaker-1')],
        participantProfiles: createDefaultParticipants(),
        highlights: '',
        takeaways: '',
        summary: '',
        followUpPlan: '',
        organizersList: [{ name: '', designation: '', signatureImage: '' }],
        useProfile: false,
        useCollaborators: false,
        activityPhotos: [],
        attendanceFiles: [],
        brochureFiles: [],
        approvalFiles: [],
        feedbackFiles: [],
    };
}

type Loose = Record<string, unknown>;

const isObject = (v: unknown): v is Loose => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const itemId = (v: unknown, fallback: string): string | number =>
    typeof v === 'string' || typeof v === 'number' ? v : fallback;

function normalizeSpeaker(raw: unknown, index: number): Speaker {
    const s = isObject(raw) ? raw : {};
    const photo = str(s.photo) || str(s.photoUrl);
    // Legacy aliases are mapped below; drop them so a field the user cleared does not come back on reload.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { title: _title, org: _org, presentation: _presentation, photoUrl: _photoUrl, ...custom } = s;
    return {
        // Keep columns added to this list in Report Format (e.g. "email").
        ...(custom as Partial<Speaker>),
        id: itemId(s.id, `speaker-${index + 1}`),
        name: str(s.name),
        designation: str(s.designation) || str(s.title),
        organization: str(s.organization) || str(s.org),
        contact: str(s.contact),
        presentationTitle: str(s.presentationTitle) || str(s.presentation),
        about: str(s.about),
        photo: photo || null,
    };
}

function normalizeParticipants(raw: Loose): ParticipantGroup[] {
    // Legacy: the form wrote `participantsProfile` while the editor defaults/AI used
    // `participantProfiles`. Whatever the user typed in the form wins.
    const legacy = arr(raw.participantsProfile);
    const source = legacy.length > 0 ? legacy : arr(raw.participantProfiles);
    if (source.length === 0) return createDefaultParticipants();
    return source.map((p, i) => {
        const o = isObject(p) ? p : {};
        return { ...(o as Partial<ParticipantGroup>), id: itemId(o.id, `group-${i + 1}`), type: str(o.type), count: str(o.count) };
    });
}

function normalizeOrganizers(raw: Loose): Organizer[] {
    const list = arr(raw.organizersList);
    if (list.length > 0) {
        return list.map((o) => {
            const x = isObject(o) ? o : {};
            return { ...(x as Partial<Organizer>), name: str(x.name), designation: str(x.designation), signatureImage: str(x.signatureImage) };
        });
    }
    // Legacy flat fields from the very first editor version.
    return [{
        name: str(raw.preparedByName),
        designation: str(raw.preparedByDesignation),
        signatureImage: str(raw.preparedBySignature),
    }];
}

function normalizePhotos(raw: unknown): ActivityPhoto[] {
    return arr(raw)
        .map((p, i) => {
            const o = isObject(p) ? p : {};
            return { ...(o as Partial<ActivityPhoto>), id: String(itemId(o.id, `photo-${i + 1}`)), url: str(o.url), caption: str(o.caption) };
        })
        .filter((p) => p.url !== '');
}

function normalizeRows(raw: unknown): SpreadsheetRow[] | null {
    if (!Array.isArray(raw)) return null;
    return raw.filter(isObject).map((row) => {
        const out: SpreadsheetRow = {};
        for (const [k, v] of Object.entries(row)) {
            out[k] = typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : v == null ? null : String(v);
        }
        return out;
    });
}

function extensionOf(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function normalizeAttachment(raw: unknown, i: number): AttachmentFile {
    const o = isObject(raw) ? raw : {};
    const name = str(o.name) || `file-${i + 1}`;
    let pages = arr(o.pages).map(str).filter(Boolean);
    const legacyUrl = str(o.url);
    const typeField = str(o.type);
    // The type used to be either an extension ("pdf") or a mime type ("application/pdf").
    const type = typeField.includes('/') ? extensionOf(name) || typeField.split('/')[1] : typeField || extensionOf(name);
    // Legacy: files uploaded from the "Insert" tab were stored as `{ url }` only.
    if (pages.length === 0 && legacyUrl && ['png', 'jpg', 'jpeg'].includes(type)) {
        pages = [legacyUrl];
    }
    return {
        id: String(itemId(o.id, `file-${i + 1}`)),
        name,
        type,
        source: str(o.source) || legacyUrl || undefined,
        pages,
        jsonData: normalizeRows(o.jsonData),
    };
}

// Keys from old payload shapes that normalizeReportData has migrated.
export const LEGACY_KEYS = ['participantsProfile', 'followUp', 'startDate', 'startTime', 'preparedByName', 'preparedByDesignation', 'preparedBySignature'];

/** Report payload: the built-in fields plus any custom fields defined by a template. */
export type ReportPayload = ReportData & Record<string, unknown>;

/**
 * Accepts any stored/partial payload and returns a complete, current-shape payload.
 * Values of custom template fields are kept untouched.
 */
export function normalizeReportData(input: unknown): ReportPayload {
    const raw: Loose = isObject(input) ? input : {};
    const base = createEmptyReportData();
    const speakers = arr(raw.speakers).map(normalizeSpeaker);

    const result: ReportData = {
        ...base,
        activityTitle: str(raw.activityTitle),
        activityType: str(raw.activityType),
        subCategory: str(raw.subCategory),
        venue: str(raw.venue),
        collaboration: str(raw.collaboration),
        date: str(raw.date) || str(raw.startDate),
        time: str(raw.time) || str(raw.startTime),
        endDate: str(raw.endDate),
        endTime: str(raw.endTime),
        speakers: speakers.length > 0 ? speakers : base.speakers,
        participantProfiles: normalizeParticipants(raw),
        highlights: str(raw.highlights),
        takeaways: str(raw.takeaways),
        summary: str(raw.summary),
        followUpPlan: str(raw.followUpPlan) || str(raw.followUp),
        organizersList: normalizeOrganizers(raw),
        useProfile: raw.useProfile === true,
        useCollaborators: raw.useCollaborators === true,
        activityPhotos: normalizePhotos(raw.activityPhotos),
        attendanceFiles: arr(raw.attendanceFiles).map(normalizeAttachment),
        brochureFiles: arr(raw.brochureFiles).map(normalizeAttachment),
        approvalFiles: arr(raw.approvalFiles).map(normalizeAttachment),
        feedbackFiles: arr(raw.feedbackFiles).map(normalizeAttachment),
    };
    const driveLink = str(raw.drive_link);
    if (driveLink) result.drive_link = driveLink;

    const extras: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
        if (!(k in result) && !LEGACY_KEYS.includes(k) && k !== '__proto__') extras[k] = v;
    }
    return { ...extras, ...result };
}

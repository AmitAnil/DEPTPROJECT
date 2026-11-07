// Storage references.
//
// Files live in two PRIVATE Supabase buckets. Instead of saving public URLs (which
// expose student attendance sheets and staff signatures to anyone with the link),
// we save a reference string `sb://<bucket>/<path>` and exchange it for a short-lived
// signed URL only when the file has to be displayed or rendered.
//
// Legacy rows still contain public URLs (`.../storage/v1/object/public/<bucket>/<path>`);
// those are parsed into references too, so old reports keep working once the buckets
// are made private.

export const STORAGE_BUCKETS = ['reports', 'signatures'] as const;
export type StorageBucket = (typeof STORAGE_BUCKETS)[number];

export const STORAGE_REF_PREFIX = 'sb://';
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

export interface StorageLocation {
    bucket: StorageBucket;
    path: string;
}

const isBucket = (b: string): b is StorageBucket => (STORAGE_BUCKETS as readonly string[]).includes(b);

export function makeStorageRef(bucket: StorageBucket, path: string): string {
    return `${STORAGE_REF_PREFIX}${bucket}/${path}`;
}

function validPath(path: string): boolean {
    return path.length > 0 && !path.split('/').some((seg) => seg === '..' || seg === '.') && !path.startsWith('/');
}

/**
 * Parses an `sb://` reference or a Supabase storage URL belonging to this project.
 * Returns null for anything else (data URLs, external URLs, empty values).
 */
export function parseStorageRef(value: unknown, supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): StorageLocation | null {
    if (typeof value !== 'string' || value === '') return null;

    if (value.startsWith(STORAGE_REF_PREFIX)) {
        const rest = value.slice(STORAGE_REF_PREFIX.length);
        const slash = rest.indexOf('/');
        if (slash <= 0) return null;
        const bucket = rest.slice(0, slash);
        const path = rest.slice(slash + 1);
        return isBucket(bucket) && validPath(path) ? { bucket, path } : null;
    }

    if (!supabaseUrl) return null;
    let url: URL;
    let base: URL;
    try {
        url = new URL(value);
        base = new URL(supabaseUrl);
    } catch {
        return null;
    }
    if (url.origin !== base.origin) return null;
    const match = url.pathname.match(/^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
    if (!match) return null;
    const bucket = match[1];
    let path: string;
    try {
        path = decodeURIComponent(match[2]);
    } catch {
        return null;
    }
    return isBucket(bucket) && validPath(path) ? { bucket, path } : null;
}

/** Signs a batch of paths in one bucket. Returns a map path -> signed URL (missing = not allowed / not found). */
export type StorageSigner = (bucket: StorageBucket, paths: string[]) => Promise<Map<string, string>>;

function collectStrings(value: unknown, out: Set<string>): void {
    if (typeof value === 'string') {
        out.add(value);
    } else if (Array.isArray(value)) {
        for (const v of value) collectStrings(v, out);
    } else if (value && typeof value === 'object') {
        for (const v of Object.values(value)) collectStrings(v, out);
    }
}

function replaceStrings<T>(value: T, map: Map<string, string>): T {
    if (typeof value === 'string') {
        return (map.has(value) ? map.get(value) : value) as T;
    }
    if (Array.isArray(value)) {
        return value.map((v) => replaceStrings(v, map)) as T;
    }
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) out[k] = replaceStrings(v, map);
        return out as T;
    }
    return value;
}

/**
 * Returns a deep copy of `data` in which every storage reference has been replaced by
 * a signed URL. References that cannot be signed (no permission, deleted file) are
 * replaced with an empty string so renderers can skip them instead of crashing.
 */
export async function resolveStorageRefs<T>(data: T, signer: StorageSigner, supabaseUrl?: string): Promise<T> {
    const strings = new Set<string>();
    collectStrings(data, strings);

    const byBucket = new Map<StorageBucket, Map<string, string[]>>(); // bucket -> path -> original strings
    for (const s of strings) {
        const loc = parseStorageRef(s, supabaseUrl);
        if (!loc) continue;
        const paths = byBucket.get(loc.bucket) ?? new Map<string, string[]>();
        paths.set(loc.path, [...(paths.get(loc.path) ?? []), s]);
        byBucket.set(loc.bucket, paths);
    }
    if (byBucket.size === 0) return data;

    const replacements = new Map<string, string>();
    await Promise.all(
        [...byBucket.entries()].map(async ([bucket, paths]) => {
            let signed = new Map<string, string>();
            try {
                signed = await signer(bucket, [...paths.keys()]);
            } catch (err) {
                console.error(`Failed to sign ${bucket} files:`, err);
            }
            for (const [path, originals] of paths) {
                for (const original of originals) replacements.set(original, signed.get(path) ?? '');
            }
        }),
    );
    return replaceStrings(data, replacements);
}

/** Collects every storage reference in `data` (used to know which files a report uses). */
export function listStorageRefs(data: unknown, supabaseUrl?: string): StorageLocation[] {
    const strings = new Set<string>();
    collectStrings(data, strings);
    const seen = new Set<string>();
    const out: StorageLocation[] = [];
    for (const s of strings) {
        const loc = parseStorageRef(s, supabaseUrl);
        if (!loc) continue;
        const key = `${loc.bucket}/${loc.path}`;
        if (!seen.has(key)) {
            seen.add(key);
            out.push(loc);
        }
    }
    return out;
}

/** Makes a user-supplied file name safe to use inside a storage path. */
export function safeFileName(name: string): string {
    const cleaned = name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[._]+/, '');
    return (cleaned || 'file').slice(-100);
}

const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Whether a file may be embedded in a given report when it is rendered with the
 * service role (which bypasses storage policies). Report data is written by its
 * authors, so without this check an author could reference anyone's file, e.g. a
 * colleague's signature, and get it into the archived PDF.
 *
 * Allowed: files in the report's own folder, and files in the folder of the owner
 * or an accepted collaborator (uploads before the first save, signatures, including
 * legacy root-level signature files named "<user-id>-<random>.<ext>").
 */
export function isPathAllowedForReport(bucket: StorageBucket, path: string, reportId: string, memberIds: readonly string[]): boolean {
    const segments = path.split('/');
    const top = segments.length > 1 ? segments[0] : '';
    const members = memberIds.map((m) => m.toLowerCase());
    if (bucket === 'reports') {
        return top.toLowerCase() === reportId.toLowerCase() || members.includes(top.toLowerCase());
    }
    // signatures
    if (top) return members.includes(top.toLowerCase());
    const legacyOwner = UUID_PREFIX.exec(path)?.[0]?.toLowerCase();
    return !!legacyOwner && members.includes(legacyOwner);
}

/** Wraps a signer so it only signs paths accepted by `allow`; others resolve to "" (skipped in the PDF). */
export function scopedSigner(signer: StorageSigner, allow: (bucket: StorageBucket, path: string) => boolean): StorageSigner {
    return async (bucket, paths) => {
        const permitted = paths.filter((p) => allow(bucket, p));
        const rejected = paths.length - permitted.length;
        if (rejected > 0) console.warn(`Refused to sign ${rejected} ${bucket} file(s) that do not belong to this report.`);
        return permitted.length > 0 ? signer(bucket, permitted) : new Map();
    };
}

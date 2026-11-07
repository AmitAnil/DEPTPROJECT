import { describe, expect, it, vi } from 'vitest';
import { listStorageRefs, makeStorageRef, parseStorageRef, resolveStorageRefs, safeFileName, type StorageSigner } from '@/lib/storage';

const SUPABASE = 'https://proj.supabase.co';

describe('parseStorageRef', () => {
    it('parses sb:// references', () => {
        expect(parseStorageRef('sb://reports/abc/photo.jpg', SUPABASE)).toEqual({ bucket: 'reports', path: 'abc/photo.jpg' });
    });

    it('parses legacy public URLs of this project', () => {
        expect(parseStorageRef(`${SUPABASE}/storage/v1/object/public/signatures/u1-0.5.png`, SUPABASE)).toEqual({
            bucket: 'signatures',
            path: 'u1-0.5.png',
        });
        expect(parseStorageRef(`${SUPABASE}/storage/v1/object/public/reports/a/My%20File.pdf?x=1`, SUPABASE)).toEqual({
            bucket: 'reports',
            path: 'a/My File.pdf',
        });
    });

    it.each([
        'https://evil.example/storage/v1/object/public/reports/a.png', // other host
        `${SUPABASE}/storage/v1/object/public/other-bucket/a.png`, // unknown bucket
        'sb://reports/../secrets', // traversal
        'sb://reports/', // empty path
        'data:image/png;base64,AAAA',
        'http://169.254.169.254/latest/meta-data',
        '',
    ])('rejects %j', (value) => {
        expect(parseStorageRef(value, SUPABASE)).toBeNull();
    });
});

describe('resolveStorageRefs', () => {
    it('replaces refs deeply, batches per bucket and blanks unsignable files', async () => {
        const signer: StorageSigner = vi.fn(async (bucket, paths) => {
            const m = new Map<string, string>();
            for (const p of paths) if (!p.includes('missing')) m.set(p, `https://signed/${bucket}/${p}`);
            return m;
        });
        const data = {
            photo: makeStorageRef('reports', 'r1/a.jpg'),
            list: [{ pages: [makeStorageRef('reports', 'r1/b.jpg'), makeStorageRef('reports', 'r1/missing.jpg')] }],
            sig: `${SUPABASE}/storage/v1/object/public/signatures/u1.png`,
            inline: 'data:image/png;base64,AAAA',
            title: 'Hello',
        };
        const out = await resolveStorageRefs(data, signer, SUPABASE);
        expect(out.photo).toBe('https://signed/reports/r1/a.jpg');
        expect(out.list[0].pages).toEqual(['https://signed/reports/r1/b.jpg', '']);
        expect(out.sig).toBe('https://signed/signatures/u1.png');
        expect(out.inline).toBe(data.inline);
        expect(out.title).toBe('Hello');
        expect(signer).toHaveBeenCalledTimes(2);
        expect(data.photo).toMatch(/^sb:\/\//); // input untouched
    });

    it('lists unique refs', () => {
        const ref = makeStorageRef('reports', 'x/y.png');
        expect(listStorageRefs({ a: ref, b: [ref] }, SUPABASE)).toEqual([{ bucket: 'reports', path: 'x/y.png' }]);
    });
});

describe('safeFileName', () => {
    it('strips path separators and odd characters', () => {
        expect(safeFileName('../../etc/passwd')).toBe('etc_passwd');
        expect(safeFileName('Attendance Sheet (final).xlsx')).toBe('Attendance_Sheet_final_.xlsx');
        expect(safeFileName('')).toBe('file');
    });
});

describe('isPathAllowedForReport / scopedSigner', () => {
    const report = '11111111-1111-1111-1111-111111111111';
    const owner = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const stranger = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    it('allows only the report folder and members', async () => {
        const { isPathAllowedForReport, scopedSigner } = await import('@/lib/storage');
        const ok = (b: 'reports' | 'signatures', p: string) => isPathAllowedForReport(b, p, report, [owner]);
        expect(ok('reports', `${report}/attendanceFiles/x.pdf`)).toBe(true);
        expect(ok('reports', `${owner}/activityPhotos/a.jpg`)).toBe(true);
        expect(ok('reports', `${stranger}/activityPhotos/a.jpg`)).toBe(false);
        expect(ok('reports', 'temp_uploads/x.png')).toBe(false);
        expect(ok('signatures', `${owner}/signature/s.png`)).toBe(true);
        expect(ok('signatures', `${owner}-0.123.png`)).toBe(true); // legacy root file
        expect(ok('signatures', `${stranger}/signature/s.png`)).toBe(false);
        expect(ok('signatures', `${stranger}-0.5.png`)).toBe(false);

        const inner: StorageSigner = vi.fn(async (_b: string, paths: string[]) => new Map<string, string>(paths.map((p) => [p, `signed:${p}`])));
        const signer = scopedSigner(inner, ok);
        const data = await resolveStorageRefs({ a: makeStorageRef('signatures', `${owner}/signature/s.png`), b: makeStorageRef('signatures', `${stranger}/signature/s.png`) }, signer, SUPABASE);
        expect(data.a).toBe(`signed:${owner}/signature/s.png`);
        expect(data.b).toBe('');
        expect(inner).toHaveBeenCalledWith('signatures', [`${owner}/signature/s.png`]);
    });
});

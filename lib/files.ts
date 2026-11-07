"use client";

// Browser-side file processing for report attachments.
//
// Every file is uploaded to the private `reports` bucket and referenced by an
// `sb://` storage ref. Nothing is stored inline as base64 any more, which keeps
// report rows small and saves fast.

import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_PDF_PAGES, MAX_UPLOAD_BYTES } from './constants';
import { makeStorageRef, safeFileName, type StorageBucket } from './storage';
import { newItemId, type AttachmentFile, type SpreadsheetRow } from './reportData';

export class FileValidationError extends Error {}

/** react-pdf can only embed PNG and JPEG images. */
const PDF_SAFE_IMAGE_TYPES = ['image/png', 'image/jpeg'];
const MAX_IMAGE_DIMENSION = 2400;
const PDF_RENDER_SCALE = 1.5;

export function fileExtension(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function assertFileSize(file: File): void {
    if (file.size > MAX_UPLOAD_BYTES) {
        throw new FileValidationError(`"${file.name}" is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
    }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode image.'))), type, quality);
    });
}

/**
 * Returns an image the PDF engine can embed: PNG/JPEG, at most 2400px on the long side.
 * PNGs stay PNG (keeps signature transparency); everything else becomes JPEG.
 */
export async function prepareImage(file: Blob): Promise<{ blob: Blob; ext: 'png' | 'jpg' }> {
    if (!file.type.startsWith('image/')) throw new FileValidationError('Only image files are allowed here.');
    const bitmap = await createImageBitmap(file).catch(() => {
        throw new FileValidationError('This image format is not supported. Please use JPG or PNG.');
    });
    try {
        const longest = Math.max(bitmap.width, bitmap.height);
        const isPng = file.type === 'image/png';
        if (PDF_SAFE_IMAGE_TYPES.includes(file.type) && longest <= MAX_IMAGE_DIMENSION) {
            return { blob: file, ext: isPng ? 'png' : 'jpg' };
        }
        const scale = Math.min(1, MAX_IMAGE_DIMENSION / longest);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas is not available.');
        if (!isPng) {
            ctx.fillStyle = '#ffffff'; // JPEG has no alpha channel
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return isPng
            ? { blob: await canvasToBlob(canvas, 'image/png'), ext: 'png' }
            : { blob: await canvasToBlob(canvas, 'image/jpeg', 0.85), ext: 'jpg' };
    } finally {
        bitmap.close();
    }
}

export interface UploadContext {
    supabase: SupabaseClient;
    /**
     * First folder of the storage path: the report id once the report is saved,
     * otherwise the user's id. Storage policies use it to decide who can read the file.
     */
    folder: string;
}

let uploadCounter = 0;
async function uploadBlob(ctx: UploadContext, bucket: StorageBucket, subfolder: string, fileName: string, blob: Blob, contentType?: string): Promise<string> {
    uploadCounter += 1;
    const path = `${ctx.folder}/${subfolder}/${Date.now()}-${uploadCounter}-${safeFileName(fileName)}`;
    const { error } = await ctx.supabase.storage.from(bucket).upload(path, blob, {
        contentType: contentType || blob.type || undefined,
        upsert: false,
    });
    if (error) throw error;
    return makeStorageRef(bucket, path);
}

/** Uploads a photo (activity photo, speaker photo) and returns its storage ref. */
export async function uploadImage(ctx: UploadContext, file: File, subfolder: string): Promise<string> {
    assertFileSize(file);
    const { blob, ext } = await prepareImage(file);
    const base = file.name.replace(/\.[^.]+$/, '');
    return uploadBlob(ctx, 'reports', subfolder, `${base}.${ext}`, blob);
}

async function renderPdfPages(file: File): Promise<Blob[]> {
    const pdfjs = await import('pdfjs-dist');
    // Bundled with the app instead of being loaded from a third-party CDN at runtime.
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

    const pdfDoc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    if (pdfDoc.numPages > MAX_PDF_PAGES) {
        throw new FileValidationError(`"${file.name}" has ${pdfDoc.numPages} pages; the limit is ${MAX_PDF_PAGES}.`);
    }
    const pages: Blob[] = [];
    for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport }).promise;
        pages.push(await canvasToBlob(canvas, 'image/jpeg', 0.85));
        page.cleanup();
    }
    await pdfDoc.destroy();
    return pages;
}

function rowsToObjects(rows: unknown[][]): SpreadsheetRow[] {
    if (rows.length === 0) return [];
    const headers = rows[0].map((h, i) => (h == null || String(h).trim() === '' ? `Column ${i + 1}` : String(h).trim()));
    return rows.slice(1)
        .filter((r) => r.some((c) => c != null && String(c).trim() !== ''))
        .map((r) => {
            const obj: SpreadsheetRow = {};
            headers.forEach((h, i) => {
                const v = r[i];
                obj[h] = v == null ? null : v instanceof Date ? v.toLocaleDateString() : typeof v === 'number' || typeof v === 'boolean' ? v : String(v);
            });
            return obj;
        });
}

async function parseSpreadsheet(file: File, ext: string): Promise<SpreadsheetRow[]> {
    if (ext === 'csv') {
        const Papa = (await import('papaparse')).default;
        const text = await file.text();
        const parsed = Papa.parse<unknown[]>(text, { skipEmptyLines: true });
        return rowsToObjects(parsed.data);
    }
    const { default: readXlsxFile } = await import('read-excel-file/browser');
    const sheets = await readXlsxFile(file);
    return rowsToObjects((sheets[0]?.data ?? []) as unknown[][]);
}

export const ATTACHMENT_ACCEPT = {
    documents: '.jpg,.jpeg,.png,.webp,.pdf',
    documentsAndSheets: '.jpg,.jpeg,.png,.webp,.pdf,.xlsx,.csv',
};

/** Uploads an attachment and converts it into page images and/or table rows for the PDF report. */
export async function processAttachment(ctx: UploadContext, file: File, subfolder: string, allowSpreadsheets: boolean): Promise<AttachmentFile> {
    assertFileSize(file);
    const ext = fileExtension(file.name);
    const id = newItemId();

    if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
        const ref = await uploadImage(ctx, file, subfolder);
        return { id, name: file.name, type: ext, source: ref, pages: [ref], jsonData: null };
    }

    if (ext === 'pdf') {
        const pageBlobs = await renderPdfPages(file);
        const source = await uploadBlob(ctx, 'reports', subfolder, file.name, file, 'application/pdf');
        const pages: string[] = [];
        for (let i = 0; i < pageBlobs.length; i++) {
            pages.push(await uploadBlob(ctx, 'reports', `${subfolder}/pages`, `${file.name}-p${i + 1}.jpg`, pageBlobs[i], 'image/jpeg'));
        }
        return { id, name: file.name, type: 'pdf', source, pages, jsonData: null };
    }

    if (allowSpreadsheets && (ext === 'xlsx' || ext === 'csv')) {
        const rows = await parseSpreadsheet(file, ext);
        const contentType = ext === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        const source = await uploadBlob(ctx, 'reports', subfolder, file.name, file, contentType);
        return { id, name: file.name, type: ext, source, pages: [], jsonData: rows };
    }

    throw new FileValidationError(`"${file.name}" is not a supported file type.`);
}

/** Uploads the user's signature image to the private `signatures` bucket. */
export async function uploadSignature(supabase: SupabaseClient, userId: string, file: File): Promise<string> {
    assertFileSize(file);
    const { blob, ext } = await prepareImage(file);
    return uploadBlob({ supabase, folder: userId }, 'signatures', 'signature', `signature.${ext}`, blob);
}

/** Human readable message for upload failures. */
export function describeUploadError(err: unknown): string {
    if (err instanceof FileValidationError) return err.message;
    if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
        return `Upload failed: ${(err as { message: string }).message}`;
    }
    return 'Upload failed. Please try again.';
}

/** Uploads a recorded voice note (AI assistant) and returns it as an attachment entry (not printed). */
export async function uploadVoiceNote(ctx: UploadContext, blob: Blob): Promise<AttachmentFile> {
    if (blob.size > MAX_UPLOAD_BYTES) throw new FileValidationError('The recording is too long. Please keep voice notes under about 10 minutes.');
    const contentType = (blob.type || 'audio/webm').split(';')[0];
    const ext = contentType.includes('mp4') ? 'm4a' : contentType.includes('ogg') ? 'ogg' : 'webm';
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const source = await uploadBlob(ctx, 'reports', 'voice-notes', `voice-note.${ext}`, blob, contentType);
    return { id: newItemId(), name: `Voice note (${stamp})`, type: ext, source, pages: [], jsonData: null };
}

/**
 * Where uploads go: a folder name (the report id), or a function that creates the
 * draft on first use and returns its id. Report files always live in the report's own
 * folder, which is what the storage policies share with collaborators.
 */
export type UploadFolder = string | (() => Promise<string | null>) | null | undefined;

export async function resolveUploadFolder(folder: UploadFolder): Promise<string | null> {
    if (!folder) return null;
    return typeof folder === 'function' ? folder() : folder;
}

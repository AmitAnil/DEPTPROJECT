import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';
import { forbidden, getAuthContext, unauthorized } from '@/lib/auth';
import { buildExtractionPrompt, sanitizeAiValues } from '@/lib/aiFill';
import { parseStorageRef } from '@/lib/storage';
import { loadTemplate } from '@/lib/templateStore';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_FILES = 20;
const MAX_NOTES_CHARS = 20_000;
// Gemini accepts up to ~20 MB of inline data per request.
const MAX_TOTAL_BYTES = 18 * 1024 * 1024;
const SUPPORTED_MIME = /^(application\/pdf|image\/(png|jpeg|webp)|text\/(csv|plain)|audio\/(webm|ogg|mp4|mpeg|wav|x-wav|aac))$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fills a report from the organiser's notes/dictation and uploaded documents.
 * Body: { notes?: string, refs?: string[] (sb:// storage refs), templateId?: string | null }
 * Returns: { values } keyed by the template's field ids.
 */
export async function POST(req: Request) {
    const auth = await getAuthContext();
    if (!auth) return unauthorized();

    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) {
        return NextResponse.json({ error: 'AI auto-fill is not configured on this server.' }, { status: 503 });
    }

    let body: { notes?: unknown; refs?: unknown; templateId?: unknown };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }
    const notes = typeof body.notes === 'string' ? body.notes.slice(0, MAX_NOTES_CHARS) : '';
    const refs = Array.isArray(body.refs) ? body.refs.filter((r): r is string => typeof r === 'string') : [];
    const templateId = typeof body.templateId === 'string' && UUID.test(body.templateId) ? body.templateId : null;

    // Only files in our own `reports` bucket are accepted - never arbitrary URLs (prevents SSRF).
    const locations = [...new Set(refs)]
        .map((r) => parseStorageRef(r))
        .filter((loc): loc is NonNullable<typeof loc> => loc !== null && loc.bucket === 'reports')
        .slice(0, MAX_FILES);
    if (locations.length === 0 && notes.trim().length < 20) {
        return NextResponse.json({ error: 'Describe the event (at least a couple of sentences) or attach documents first.' }, { status: 400 });
    }

    // Download as the signed-in user, so storage policies decide what they may read.
    const parts: { inlineData: { data: string; mimeType: string } }[] = [];
    let totalBytes = 0;
    for (const loc of locations) {
        const { data: blob, error } = await auth.supabase.storage.from(loc.bucket).download(loc.path);
        if (error || !blob) return forbidden();
        const mimeType = (blob.type || '').split(';')[0];
        if (!SUPPORTED_MIME.test(mimeType)) continue; // e.g. .xlsx - not supported by the model
        if (totalBytes + blob.size > MAX_TOTAL_BYTES) continue;
        totalBytes += blob.size;
        parts.push({ inlineData: { data: Buffer.from(await blob.arrayBuffer()).toString('base64'), mimeType } });
    }

    const { definition: template } = await loadTemplate(auth.supabase, templateId);

    try {
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
            model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: buildExtractionPrompt(template, notes) }, ...parts] }],
            config: { responseMimeType: 'application/json', temperature: 0.2 },
        });
        const text = (response.text ?? '').replace(/```json|```/g, '').trim();
        return NextResponse.json({ values: sanitizeAiValues(template, JSON.parse(text)), filesUsed: parts.length });
    } catch (error) {
        console.error('AI extraction error:', error);
        return NextResponse.json({ error: 'AI auto-fill failed. Please try again or fill the form manually.' }, { status: 502 });
    }
}

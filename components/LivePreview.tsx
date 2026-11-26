"use client";

import React, { useEffect, useRef, useState } from 'react';
import { pdf } from '@react-pdf/renderer';
import { ReportPDF } from './ReportPDF';
import { normalizeReportData } from '@/lib/reportData';
import { resolveForBrowser } from '@/lib/storageClient';
import { DEFAULT_TEMPLATE, type ReportTemplate } from '@/lib/template';
import { describeSkipped, renderWithFallback, type SkippedPart } from '@/lib/previewFallback';

const DEBOUNCE_MS = 800;

export default function LivePreview({ data, template = DEFAULT_TEMPLATE }: { data: unknown; template?: ReportTemplate }) {
    // Two iframes ("double buffer") so the preview never flashes white while re-rendering.
    const [activePdfUrl, setActivePdfUrl] = useState<string | null>(null);
    const [nextPdfUrl, setNextPdfUrl] = useState<string | null>(null);
    const [isUpdating, setIsUpdating] = useState(false);
    // Parts of the report that could not be drawn and were left out of the preview.
    const [skipped, setSkipped] = useState<SkippedPart[]>([]);
    const [failed, setFailed] = useState(false);
    const generation = useRef(0);
    const urls = useRef(new Set<string>());

    useEffect(() => {
        const run = ++generation.current;
        const timer = setTimeout(async () => {
            setIsUpdating(true);
            try {
                const resolved = await resolveForBrowser(normalizeReportData(data));
                // If something cannot be drawn, show the rest and name what was left out.
                const result = await renderWithFallback(template, (t) => pdf(<ReportPDF data={resolved} template={t} />).toBlob());
                if (run !== generation.current) return; // a newer edit started meanwhile
                if (result.skipped.length > 0) {
                    console.warn(`PDF preview: left out ${describeSkipped(result.skipped)} (${result.error})`);
                }
                setSkipped(result.skipped);
                setFailed(false);
                const url = URL.createObjectURL(result.output);
                urls.current.add(url);
                setNextPdfUrl(url);
            } catch (error) {
                console.warn('PDF preview error:', error);
                if (run === generation.current) setFailed(true);
            } finally {
                if (run === generation.current) setIsUpdating(false);
            }
        }, DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [data, template]);

    // Free every blob URL that is no longer displayed.
    useEffect(() => {
        for (const url of urls.current) {
            if (url !== activePdfUrl && url !== nextPdfUrl) {
                URL.revokeObjectURL(url);
                urls.current.delete(url);
            }
        }
    }, [activePdfUrl, nextPdfUrl]);

    // Free everything on unmount.
    useEffect(() => {
        const owned = urls.current;
        return () => {
            owned.forEach((url) => URL.revokeObjectURL(url));
            owned.clear();
        };
    }, []);

    return (
        <div className="h-full w-full bg-[#525659] rounded-xl overflow-hidden shadow-inner flex flex-col border border-gray-300 relative">
            {isUpdating && (
                <div className="absolute top-4 right-4 bg-black/60 text-white text-[10px] px-3 py-1 rounded-full uppercase tracking-widest z-50 animate-pulse shadow-md">
                    Updating...
                </div>
            )}

            {(skipped.length > 0 || failed) && (
                <div role="status" className="absolute bottom-3 left-3 right-3 z-50 rounded-lg bg-amber-50 border border-amber-300 px-3 py-2 text-xs text-amber-900 shadow">
                    {failed
                        ? 'The preview could not be drawn. Your work is saved; please tell your admin what you last changed.'
                        : <>Could not draw <b>{describeSkipped(skipped)}</b> in the preview, so it is left out for now. Check that content (for example a damaged image or unusual characters).</>}
                </div>
            )}

            {!activePdfUrl && !nextPdfUrl && (
                <div className="absolute inset-0 flex items-center justify-center text-gray-300 font-bold uppercase tracking-widest text-xs">
                    Initializing Engine...
                </div>
            )}

            {activePdfUrl && (
                <iframe
                    src={`${activePdfUrl}#toolbar=0&navpanes=0&scrollbar=0`}
                    className="absolute inset-0 w-full h-full border-none z-10"
                    title="Report preview"
                />
            )}

            {nextPdfUrl && (
                <iframe
                    src={`${nextPdfUrl}#toolbar=0&navpanes=0&scrollbar=0`}
                    className="absolute inset-0 w-full h-full border-none z-0 opacity-0"
                    title="Report preview (loading)"
                    onLoad={() => {
                        setActivePdfUrl(nextPdfUrl);
                        setNextPdfUrl(null);
                    }}
                />
            )}
        </div>
    );
}

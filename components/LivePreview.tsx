"use client";

import React, { useEffect, useRef, useState } from 'react';
import { pdf } from '@react-pdf/renderer';
import { ReportPDF } from './ReportPDF';
import { normalizeReportData } from '@/lib/reportData';
import { resolveForBrowser } from '@/lib/storageClient';
import { DEFAULT_TEMPLATE, type ReportTemplate } from '@/lib/template';

const DEBOUNCE_MS = 800;

export default function LivePreview({ data, template = DEFAULT_TEMPLATE }: { data: unknown; template?: ReportTemplate }) {
    // Two iframes ("double buffer") so the preview never flashes white while re-rendering.
    const [activePdfUrl, setActivePdfUrl] = useState<string | null>(null);
    const [nextPdfUrl, setNextPdfUrl] = useState<string | null>(null);
    const [isUpdating, setIsUpdating] = useState(false);
    const generation = useRef(0);
    const urls = useRef(new Set<string>());

    useEffect(() => {
        const run = ++generation.current;
        const timer = setTimeout(async () => {
            setIsUpdating(true);
            try {
                const resolved = await resolveForBrowser(normalizeReportData(data));
                const blob = await pdf(<ReportPDF data={resolved} template={template} />).toBlob();
                if (run !== generation.current) return; // a newer edit started meanwhile
                const url = URL.createObjectURL(blob);
                urls.current.add(url);
                setNextPdfUrl(url);
            } catch (error) {
                console.error('PDF preview error:', error);
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

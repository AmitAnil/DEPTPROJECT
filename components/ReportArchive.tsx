"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { Archive, CalendarDays, Download, Eye, Loader2, MapPin, RefreshCw, Search, User } from 'lucide-react';
import { filterArchive, type ArchivedReport } from '@/lib/archive';
import { shortDate } from '@/lib/events';

const input = 'px-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-[#3168d8]';

/**
 * The department's archive: every approved report, as saved in Google Drive. Reports open through
 * DeptDocs, so the Drive folder stays private.
 */
export default function ReportArchive() {
    const [reports, setReports] = useState<ArchivedReport[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [type, setType] = useState('');
    const [year, setYear] = useState('');
    const [tick, setTick] = useState(0);

    useEffect(() => {
        let cancelled = false;
        fetch('/api/archive', { cache: 'no-store' })
            .then(async (res) => {
                const body = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(body.error || 'Could not load the archive.');
                if (!cancelled) { setReports(body.reports as ArchivedReport[]); setError(null); }
            })
            .catch((e: Error) => { if (!cancelled) setError(e.message); });
        return () => { cancelled = true; };
    }, [tick]);

    const types = useMemo(() => [...new Set((reports ?? []).map((r) => r.activityType).filter(Boolean) as string[])].sort(), [reports]);
    const years = useMemo(() => [...new Set((reports ?? []).map((r) => (r.eventDate ?? r.approvedAt).slice(0, 4)))].sort().reverse(), [reports]);
    const shown = useMemo(() => filterArchive(reports ?? [], { query, type, year }), [reports, query, type, year]);

    return (
        <section aria-labelledby="archive-heading" className="w-full bg-white rounded-3xl shadow-sm border border-gray-100 p-6 text-left">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-5">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-50 text-[#3168d8] flex items-center justify-center"><Archive size={20} /></div>
                    <div>
                        <h2 id="archive-heading" className="text-lg font-extrabold text-[#112a53]">Department report archive</h2>
                        <p className="text-sm text-gray-500">
                            {reports === null ? 'Loading…' : `${reports.length} approved event report${reports.length === 1 ? '' : 's'} saved in Google Drive`}
                        </p>
                    </div>
                </div>
                <button onClick={() => { setReports(null); setTick((t) => t + 1); }} aria-label="Refresh archive"
                    className="self-start md:self-auto p-2 rounded-full text-gray-400 hover:text-[#3168d8] hover:bg-blue-50"><RefreshCw size={18} /></button>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 mb-5">
                <label className="relative flex-1">
                    <span className="sr-only">Search reports</span>
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="search" className={`${input} w-full pl-9`} placeholder="Search by title, venue or organizer"
                        value={query} onChange={(e) => setQuery(e.target.value)} />
                </label>
                <select aria-label="Type of activity" className={input} value={type} onChange={(e) => setType(e.target.value)}>
                    <option value="">All types</option>
                    {types.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <select aria-label="Year" className={input} value={year} onChange={(e) => setYear(e.target.value)}>
                    <option value="">All years</option>
                    {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
            </div>

            {error && <p role="alert" className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</p>}
            {reports === null && !error && <div className="py-12 flex justify-center text-gray-400"><Loader2 className="animate-spin" /></div>}
            {reports !== null && shown.length === 0 && (
                <p className="py-10 text-center text-sm text-gray-500">
                    {reports.length === 0 ? 'No reports have been approved yet.' : 'No reports match your search.'}
                </p>
            )}

            {shown.length > 0 && (
                <ul className="divide-y divide-gray-100">
                    {shown.map((r) => (
                        <li key={r.id} className="py-4 flex flex-col md:flex-row md:items-center gap-3 md:gap-6">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <p className="font-bold text-gray-900">{r.title}</p>
                                    {r.activityType && <span className="px-2 py-0.5 rounded-full bg-blue-50 text-[#1f4ea8] text-[11px] font-bold">{r.activityType}</span>}
                                </div>
                                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                                    {r.eventDate && <span className="flex items-center gap-1"><CalendarDays size={12} /> {shortDate(r.eventDate)} {r.eventDate.slice(0, 4)}</span>}
                                    {r.venue && <span className="flex items-center gap-1"><MapPin size={12} /> {r.venue}</span>}
                                    {r.organizer && <span className="flex items-center gap-1"><User size={12} /> {r.organizer}</span>}
                                </div>
                            </div>
                            {r.hasPdf ? (
                                <div className="flex gap-2 shrink-0">
                                    <a href={`/api/archive/${r.id}/pdf`} target="_blank" rel="noopener noreferrer"
                                        className="px-3 py-2 rounded-xl bg-[#3168d8] text-white text-xs font-bold hover:bg-[#2552b0] flex items-center gap-1.5"><Eye size={14} /> View</a>
                                    <a href={`/api/archive/${r.id}/pdf?download=1`}
                                        className="px-3 py-2 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 hover:border-[#3168d8] hover:text-[#3168d8] flex items-center gap-1.5"><Download size={14} /> Download</a>
                                </div>
                            ) : (
                                <span className="text-xs text-gray-400 shrink-0">PDF not in Drive</span>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

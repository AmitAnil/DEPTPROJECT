"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { parseStorageRef } from '@/lib/storage';
import {
    announceEventsChanged, loadEvents, longDate, monthGrid, organizerLabel, timeRangeLabel, toISODate, WEEKDAYS, type CalendarEvent,
} from '@/lib/events';
import ScheduleEventForm from './ScheduleEventForm';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, FileText, Loader2, Plus, Trash2, User, X } from 'lucide-react';

const STATUS_BADGE: Record<string, { text: string; className: string }> = {
    draft: { text: 'Report pending', className: 'bg-amber-100 text-amber-700' },
    completed: { text: 'Report submitted', className: 'bg-blue-100 text-[#3168d8]' },
    approved: { text: 'Report approved', className: 'bg-green-100 text-green-700' },
};

/**
 * Month calendar of department events. Clicking a day shows its events; admins can schedule
 * a new event there (title, time, organizer, NFA) or cancel one.
 */
export default function EventCalendar({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
    const [supabase] = useState(createClient);
    const today = toISODate(new Date());
    const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    const days = useMemo(() => monthGrid(month.getFullYear(), month.getMonth()), [month]);
    const from = toISODate(days[0]);
    const to = toISODate(days[days.length - 1]);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            setEvents(await loadEvents(supabase, from, to));
        } catch (error) {
            console.error('Could not load events:', error);
        } finally {
            setLoading(false);
        }
    }, [supabase, from, to]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- load the visible month
        void refresh();
    }, [refresh]);

    const byDate = useMemo(() => {
        const map = new Map<string, CalendarEvent[]>();
        for (const e of events) map.set(e.event_date, [...(map.get(e.event_date) ?? []), e]);
        return map;
    }, [events]);

    const openDay = (iso: string) => {
        setSelected(iso);
        setNotice(null);
        setShowForm(isAdmin && !(byDate.get(iso)?.length));
    };
    const closeDay = () => { setSelected(null); setShowForm(false); };

    const viewNfa = async (e: CalendarEvent) => {
        const loc = parseStorageRef(e.nfa_ref);
        if (!loc) return;
        const { data, error } = await supabase.storage.from(loc.bucket).createSignedUrl(loc.path, 600);
        if (error || !data?.signedUrl) { alert('Could not open the NFA.'); return; }
        window.open(data.signedUrl, '_blank', 'noopener');
    };

    const cancelEvent = async (e: CalendarEvent) => {
        const pending = e.report?.status === 'draft' || !e.report;
        const what = !e.organizer_id ? ' The organizer will be emailed and will stop getting reminders.'
            : pending ? ' Its draft report will be deleted and the organizer will stop getting reminders.' : '';
        if (!confirm(`Cancel "${e.title}"?${what}`)) return;
        setBusyId(e.id);
        const { error } = await supabase.rpc('cancel_event', { p_event: e.id });
        setBusyId(null);
        if (error) { alert(error.message); return; }
        setNotice(`"${e.title}" was cancelled and the organizer was notified.`);
        announceEventsChanged();
        void refresh();
    };

    const dayEvents = selected ? byDate.get(selected) ?? [] : [];
    const monthLabel = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(month);

    return (
        <section aria-labelledby="calendar-heading" className="w-full bg-white rounded-3xl shadow-sm border border-gray-100 p-6 text-left">
            <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-50 text-[#3168d8] flex items-center justify-center"><CalendarDays size={20} /></div>
                    <div>
                        <h2 id="calendar-heading" className="text-lg font-extrabold text-[#112a53]">Event calendar</h2>
                        <p className="text-sm text-gray-500">{isAdmin ? 'Click a date to schedule an event.' : 'Click a date to see its events.'}</p>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month"
                        className="p-2 rounded-full text-gray-500 hover:bg-gray-100"><ChevronLeft size={18} /></button>
                    <span className="min-w-36 text-center text-sm font-bold text-gray-800">{monthLabel}</span>
                    <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month"
                        className="p-2 rounded-full text-gray-500 hover:bg-gray-100"><ChevronRight size={18} /></button>
                    <button onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}
                        className="ml-1 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-bold text-gray-600 hover:border-[#3168d8] hover:text-[#3168d8]">Today</button>
                </div>
            </div>

            <div className="grid grid-cols-7 text-center text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                {WEEKDAYS.map((d) => <div key={d} className="py-1">{d}</div>)}
            </div>
            <div className={`grid grid-cols-7 gap-1 ${loading ? 'opacity-60' : ''}`}>
                {days.map((d) => {
                    const iso = toISODate(d);
                    const inMonth = d.getMonth() === month.getMonth();
                    const list = byDate.get(iso) ?? [];
                    const isToday = iso === today;
                    return (
                        <button key={iso} type="button" onClick={() => openDay(iso)}
                            aria-label={`${longDate(iso)}${list.length ? `, ${list.length} event${list.length > 1 ? 's' : ''}` : ''}`}
                            className={`min-h-20 rounded-xl border p-1.5 text-left align-top transition-colors hover:border-[#3168d8] hover:bg-blue-50/40
                                ${inMonth ? 'bg-white border-gray-100' : 'bg-gray-50/60 border-transparent text-gray-300'}`}>
                            <span className={`inline-flex w-6 h-6 items-center justify-center rounded-full text-xs font-bold
                                ${isToday ? 'bg-[#3168d8] text-white' : inMonth ? 'text-gray-700' : ''}`}>{d.getDate()}</span>
                            <div className="mt-1 space-y-0.5">
                                {list.slice(0, 2).map((e) => (
                                    <div key={e.id} title={e.title}
                                        className={`truncate rounded-md px-1.5 py-0.5 text-[10px] font-semibold
                                            ${e.organizer_id === userId ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-[#1f4ea8]'}`}>
                                        {e.start_time ? `${e.start_time.slice(0, 5)} ` : ''}{e.title}
                                    </div>
                                ))}
                                {list.length > 2 && <div className="px-1 text-[10px] font-bold text-gray-500">+{list.length - 2} more</div>}
                            </div>
                        </button>
                    );
                })}
            </div>
            <p className="mt-3 text-xs text-gray-400 flex items-center gap-3">
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-amber-200" /> You are the organizer</span>
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-blue-200" /> Other events</span>
            </p>

            {selected && (
                <div role="dialog" aria-modal="true" aria-labelledby="day-heading"
                    className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={closeDay}>
                    <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-white rounded-3xl shadow-xl p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-start justify-between gap-3">
                            <h3 id="day-heading" className="text-lg font-extrabold text-[#112a53]">{longDate(selected)}</h3>
                            <button onClick={closeDay} aria-label="Close" className="p-1.5 rounded-full text-gray-400 hover:bg-gray-100"><X size={18} /></button>
                        </div>

                        {notice && <p role="status" className="p-3 rounded-xl bg-green-50 border border-green-200 text-sm text-green-700">{notice}</p>}

                        {dayEvents.length === 0 && !showForm && <p className="text-sm text-gray-500">No events on this day.</p>}
                        {dayEvents.length > 0 && (
                            <ul className="space-y-3">
                                {dayEvents.map((e) => {
                                    const notSignedUp = !e.organizer_id;
                                    const badge = notSignedUp
                                        ? { text: 'Organizer not signed up yet', className: 'bg-gray-100 text-gray-600' }
                                        : e.report ? STATUS_BADGE[e.report.status] : null;
                                    const isOrganizer = e.organizer_id === userId;
                                    return (
                                        <li key={e.id} className="rounded-2xl border border-gray-100 p-4 space-y-2">
                                            <div className="flex items-start justify-between gap-2">
                                                <p className="font-bold text-gray-900">{e.title}</p>
                                                {badge && <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold ${badge.className}`}>{badge.text}</span>}
                                            </div>
                                            <p className="text-sm text-gray-600 flex items-center gap-2"><Clock size={14} /> {timeRangeLabel(e)}</p>
                                            <p className="text-sm text-gray-600 flex items-center gap-2"><User size={14} />
                                                {organizerLabel(e)}
                                                {notSignedUp && e.organizer_name && e.organizer_email && <span className="text-gray-400">({e.organizer_email})</span>}
                                                {isOrganizer && <span className="text-amber-700 font-bold">(you)</span>}</p>
                                            <div className="flex flex-wrap gap-2 pt-1">
                                                {isOrganizer && e.report_id && (
                                                    <Link href={`/home/new?id=${e.report_id}`} className="px-3 py-1.5 rounded-lg bg-[#3168d8] text-white text-xs font-bold hover:bg-[#2552b0]">Open report</Link>
                                                )}
                                                {e.nfa_ref && (isAdmin || isOrganizer) && (
                                                    <button onClick={() => void viewNfa(e)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-bold text-gray-700 hover:border-[#3168d8] flex items-center gap-1">
                                                        <FileText size={12} /> View NFA
                                                    </button>
                                                )}
                                                {isAdmin && (
                                                    <button onClick={() => void cancelEvent(e)} disabled={busyId === e.id}
                                                        className="px-3 py-1.5 rounded-lg border border-red-200 text-xs font-bold text-red-600 hover:bg-red-50 flex items-center gap-1 disabled:opacity-50">
                                                        {busyId === e.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Cancel event
                                                    </button>
                                                )}
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}

                        {isAdmin && (showForm ? (
                            <div className={dayEvents.length > 0 ? 'pt-4 border-t border-gray-100' : ''}>
                                <ScheduleEventForm key={selected} supabase={supabase} date={selected}
                                    onCancel={dayEvents.length > 0 ? () => setShowForm(false) : closeDay}
                                    onScheduled={(message) => {
                                        setShowForm(false);
                                        setNotice(message);
                                        announceEventsChanged();
                                        void refresh();
                                    }} />
                            </div>
                        ) : (
                            <button onClick={() => { setShowForm(true); setNotice(null); }}
                                className="w-full py-2.5 rounded-xl border-2 border-dashed border-gray-200 text-sm font-bold text-gray-500 hover:border-[#3168d8] hover:text-[#3168d8] flex items-center justify-center gap-2">
                                <Plus size={16} /> Schedule another event on this day
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </section>
    );
}

"use client";

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { buildChecklist, loadPendingTasks, todoCount, type ChecklistGroup, type ChecklistKind } from '@/lib/pendingTasks';
import { EVENTS_CHANGED } from '@/lib/events';
import { CheckCircle2, ChevronDown, ChevronRight, Circle, Clock, ListChecks, Loader2, RefreshCw } from 'lucide-react';

/** How many entries each group shows before "and N more". */
const PREVIEW_COUNT = 3;

/** Where "and N more" leads for each group. */
const MORE_HREF: Record<ChecklistKind, string> = {
    review: '/admin',
    revise: '/home/open',
    events: '/home/open',
    drafts: '/home/open',
    invites: '/settings?tab=Requests',
    waiting: '/home/open',
};

const ACCENT: Record<ChecklistKind, string> = {
    review: 'bg-orange-100 text-orange-700',
    revise: 'bg-red-100 text-red-700',
    events: 'bg-amber-100 text-amber-800',
    drafts: 'bg-blue-100 text-[#3168d8]',
    invites: 'bg-purple-100 text-purple-700',
    waiting: 'bg-gray-100 text-gray-600',
};

/**
 * "Your checklist": what the signed-in user still has to do. Admins see the reports waiting for
 * their approval first; everyone sees reports sent back to them, unfinished drafts and invitations.
 */
export default function PendingChecklist({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
    const [supabase] = useState(createClient);
    const [groups, setGroups] = useState<ChecklistGroup[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [open, setOpen] = useState<Partial<Record<ChecklistKind, boolean>>>({});

    const load = useCallback(async () => {
        setRefreshing(true);
        try {
            setGroups(buildChecklist(await loadPendingTasks(supabase, userId, isAdmin)));
            setFailed(false);
        } catch (error) {
            console.error('Could not load the checklist:', error);
            setFailed(true);
        } finally {
            setRefreshing(false);
        }
    }, [supabase, userId, isAdmin]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
        void load();
        // Coming back to the tab (e.g. after reviewing a report elsewhere) refreshes the counts.
        const onFocus = () => { void load(); };
        window.addEventListener('focus', onFocus);
        // Scheduling or cancelling an event on the calendar changes the to-dos.
        window.addEventListener(EVENTS_CHANGED, onFocus);
        return () => {
            window.removeEventListener('focus', onFocus);
            window.removeEventListener(EVENTS_CHANGED, onFocus);
        };
    }, [load]);

    const total = groups ? todoCount(groups) : 0;
    // Groups with work start expanded.
    const isOpen = (g: ChecklistGroup) => open[g.kind] ?? (g.isTodo && g.entries.length > 0);

    return (
        <section aria-labelledby="checklist-heading" className="w-full max-w-3xl bg-white rounded-3xl shadow-sm border border-gray-100 p-6 text-left animate-in fade-in duration-500">
            <div className="flex items-center justify-between gap-4 mb-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-50 text-[#3168d8] flex items-center justify-center"><ListChecks size={20} /></div>
                    <div>
                        <h2 id="checklist-heading" className="text-lg font-extrabold text-[#112a53]">Your checklist</h2>
                        <p className="text-sm text-gray-500">
                            {groups === null ? 'Loading your tasks…'
                                : failed ? 'Could not load your tasks.'
                                    : total === 0 ? "You're all caught up."
                                        : `${total} thing${total === 1 ? '' : 's'} to do`}
                        </p>
                    </div>
                </div>
                <button onClick={() => void load()} disabled={refreshing} title="Refresh" aria-label="Refresh checklist"
                    className="p-2 rounded-full text-gray-400 hover:text-[#3168d8] hover:bg-blue-50 disabled:opacity-50">
                    {refreshing ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
                </button>
            </div>

            {groups && (
                <ul className="divide-y divide-gray-100">
                    {groups.map((g) => {
                        const count = g.entries.length;
                        const expanded = isOpen(g) && count > 0;
                        const done = count === 0;
                        return (
                            <li key={g.kind} className="py-3">
                                <button type="button" disabled={done} aria-expanded={expanded}
                                    onClick={() => setOpen((o) => ({ ...o, [g.kind]: !expanded }))}
                                    className="w-full flex items-center gap-3 text-left disabled:cursor-default">
                                    {done ? <CheckCircle2 size={20} className="text-green-500 shrink-0" />
                                        : g.isTodo ? <Circle size={20} className="text-gray-300 shrink-0" />
                                            : <Clock size={20} className="text-gray-400 shrink-0" />}
                                    <span className={`flex-1 text-sm font-bold ${done ? 'text-gray-400' : 'text-gray-800'}`}>
                                        {done ? g.doneLabel : g.label}
                                    </span>
                                    {!done && <span className={`min-w-7 px-2 py-0.5 rounded-full text-xs font-black text-center ${ACCENT[g.kind]}`}>{count}</span>}
                                    {!done && (expanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />)}
                                </button>

                                {expanded && (
                                    <ul className="mt-2 ml-8 space-y-2">
                                        {g.entries.slice(0, PREVIEW_COUNT).map((e) => (
                                            <li key={e.id} className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2">
                                                <div className="min-w-0">
                                                    <p className="text-sm font-semibold text-gray-800 truncate">{e.title}</p>
                                                    {e.detail && <p className="text-xs text-gray-500 truncate">{e.detail}</p>}
                                                </div>
                                                <Link href={e.href} className="shrink-0 px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs font-bold text-[#3168d8] hover:border-[#3168d8]">
                                                    {e.actionLabel}
                                                </Link>
                                            </li>
                                        ))}
                                        {count > PREVIEW_COUNT && (
                                            <li>
                                                <Link href={MORE_HREF[g.kind]} className="text-xs font-bold text-[#3168d8] hover:underline">
                                                    and {count - PREVIEW_COUNT} more →
                                                </Link>
                                            </li>
                                        )}
                                    </ul>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

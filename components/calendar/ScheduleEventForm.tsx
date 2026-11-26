"use client";

import React, { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AlertCircle, CalendarPlus, CheckCircle2, Info, Loader2, Upload, X } from 'lucide-react';
import { ATTACHMENT_ACCEPT, describeUploadError, processAttachment } from '@/lib/files';
import { kickEmailDispatch } from '@/lib/notifyClient';
import { loadActiveTemplate } from '@/lib/templateStore';
import { nfaFieldId, prefillEventReport, resolveOrganizer, toISODate, type OrganizerOption } from '@/lib/events';

interface Props {
    supabase: SupabaseClient;
    /** Date picked on the calendar (YYYY-MM-DD). */
    date: string;
    onScheduled: (message: string) => void;
    onCancel?: () => void;
}

const input = 'w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#3168d8] bg-white';
const label = 'text-xs font-bold text-gray-600';

/** Admin form: schedules an event, creates the organizer's draft report, uploads the NFA and emails the organizer. */
export default function ScheduleEventForm({ supabase, date: initialDate, onScheduled, onCancel }: Props) {
    const [date, setDate] = useState(initialDate);
    const [start, setStart] = useState('');
    const [end, setEnd] = useState('');
    const [title, setTitle] = useState('');
    const [organizerText, setOrganizerText] = useState('');
    const [organizerName, setOrganizerName] = useState('');
    const [nfa, setNfa] = useState<File | null>(null);
    const [organizers, setOrganizers] = useState<OrganizerOption[] | null>(null);
    const [errors, setErrors] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        supabase.from('profiles').select('id, full_name, email').eq('is_active', true).order('full_name')
            .then(({ data }) => { if (!cancelled) setOrganizers((data ?? []) as OrganizerOption[]); });
        return () => { cancelled = true; };
    }, [supabase]);

    const choice = resolveOrganizer(organizerText, organizers ?? []);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const problems: string[] = [];
        if (!date) problems.push('Choose the event date.');
        if (!start) problems.push('Choose the start time.');
        if (start && end && end < start) problems.push('The end time must be after the start time.');
        if (!title.trim()) problems.push('Enter the event title.');
        if (choice.kind === 'empty') problems.push('Choose the organizer or type their email.');
        if (choice.kind === 'invalid') problems.push('Pick a person from the list or type a valid email address.');
        setErrors(problems);
        if (problems.length > 0) return;

        setSaving(true);
        try {
            const active = await loadActiveTemplate(supabase);
            const data = prefillEventReport(active.definition, { title, date, start, end: end || undefined });
            const member = choice.kind === 'member' ? choice.person : null;
            const external = choice.kind === 'email' ? choice.email : null;
            const { data: rows, error } = await supabase.rpc('schedule_event', {
                p_title: title.trim(), p_date: date, p_start: start, p_end: end || null, p_organizer: member?.id ?? null,
                p_template: active.id, p_data: data, p_today: toISODate(new Date()),
                p_organizer_email: external, p_organizer_name: external ? organizerName.trim() || null : null,
            });
            if (error) throw error;
            const created = (Array.isArray(rows) ? rows[0] : rows) as { event_id: string; report_id: string | null } | null;
            kickEmailDispatch();

            let message = member
                ? `Event scheduled. ${member.full_name || member.email} has been emailed and the report is in their to-do list.`
                : `Event scheduled. An email was sent to ${external}. When they sign up to DeptDocs with that address, `
                    + 'the event and its prefilled report will be in their account.';

            if (nfa && created) {
                try {
                    const field = nfaFieldId(active.definition) ?? 'approvalFiles';
                    // Without a report yet (organizer not signed up), the file waits in the event's folder.
                    const folder = created.report_id ?? created.event_id;
                    const file = await processAttachment({ supabase, folder }, nfa, field, false);
                    const withNfa = { ...data, [field]: [file] };
                    if (created.report_id) {
                        const { error: reportError } = await supabase.from('reports').update({ data: withNfa }).eq('id', created.report_id);
                        if (reportError) throw reportError;
                    }
                    const { error: eventError } = await supabase.from('events')
                        .update({ nfa_ref: file.source, nfa_name: nfa.name, ...(created.report_id ? {} : { report_data: withNfa }) })
                        .eq('id', created.event_id);
                    if (eventError) throw eventError;
                } catch (uploadError) {
                    console.error('NFA upload failed:', uploadError);
                    message += ` But the NFA could not be uploaded (${describeUploadError(uploadError)}). The organizer can add it in the report.`;
                }
            }
            onScheduled(message);
        } catch (err) {
            console.error('Scheduling failed:', err);
            setErrors([err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : 'Could not schedule the event.']);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={submit} className="space-y-4" noValidate>
            <h4 className="font-bold text-[#112a53] flex items-center gap-2"><CalendarPlus size={18} /> Schedule an event</h4>

            {errors.length > 0 && (
                <div role="alert" className="p-3 rounded-xl border border-red-200 bg-red-50 text-sm text-red-700">
                    {errors.map((m) => <p key={m} className="flex items-center gap-2"><AlertCircle size={14} /> {m}</p>)}
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="space-y-1"><span className={label}>Date *</span>
                    <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} /></label>
                <label className="space-y-1"><span className={label}>Start time *</span>
                    <input type="time" className={input} value={start} onChange={(e) => setStart(e.target.value)} /></label>
                <label className="space-y-1"><span className={label}>End time</span>
                    <input type="time" className={input} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
            </div>

            <label className="block space-y-1"><span className={label}>Event title *</span>
                <input type="text" className={input} value={title} maxLength={300} placeholder="e.g. Workshop on Generative AI"
                    onChange={(e) => setTitle(e.target.value)} /></label>

            <div className="space-y-1">
                <label htmlFor="organizer-input" className={label}>Organizer *</label>
                <input id="organizer-input" type="text" list="organizer-options" className={input} value={organizerText}
                    autoComplete="off" placeholder={organizers ? 'Pick a person, or type any email address' : 'Loading people…'}
                    onChange={(e) => setOrganizerText(e.target.value)} />
                <datalist id="organizer-options">
                    {(organizers ?? []).filter((o) => o.email).map((o) => (
                        <option key={o.id} value={o.email!} label={o.full_name || o.email!} />
                    ))}
                </datalist>
                {choice.kind === 'member' && (
                    <p className="text-xs text-green-700 flex items-center gap-1.5"><CheckCircle2 size={13} />
                        {choice.person.full_name || choice.person.email} is on DeptDocs: email now, daily reminders, and the report in their to-do list.</p>
                )}
                {choice.kind === 'email' && (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
                        <p className="text-xs text-amber-800 flex gap-1.5"><Info size={13} className="shrink-0 mt-0.5" />
                            {choice.email} is not on DeptDocs yet. They will get the emails and daily reminders, and can sign up
                            with this address; the event and its prefilled report will then be in their account.</p>
                        <input type="text" className={input} value={organizerName} maxLength={200}
                            placeholder="Their name (optional, used in the emails)" onChange={(e) => setOrganizerName(e.target.value)} />
                    </div>
                )}
                {(choice.kind === 'empty' || choice.kind === 'invalid') && (
                    <span className="text-xs text-gray-400">Start typing a name or email to pick someone, or enter the full email address of anyone else.</span>
                )}
            </div>

            <div className="space-y-1">
                <span className={label}>NFA (Notice for Approval)</span>
                {nfa ? (
                    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-blue-50 text-sm">
                        <span className="truncate text-[#112a53] font-medium">{nfa.name}</span>
                        <button type="button" onClick={() => setNfa(null)} aria-label="Remove NFA" className="text-gray-400 hover:text-red-500"><X size={16} /></button>
                    </div>
                ) : (
                    <label className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl border-2 border-dashed border-gray-200 text-sm text-gray-500 cursor-pointer hover:border-[#3168d8] hover:text-[#3168d8]">
                        <Upload size={16} /> Upload PDF or image
                        <input type="file" accept={ATTACHMENT_ACCEPT.documents} className="sr-only" onChange={(e) => setNfa(e.target.files?.[0] ?? null)} />
                    </label>
                )}
                <span className="text-xs text-gray-400">Added to the report&apos;s NFA section. Optional now; the organizer can also upload it later.</span>
            </div>

            <div className="flex justify-end gap-2 pt-1">
                {onCancel && <button type="button" onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-100">Cancel</button>}
                <button type="submit" disabled={saving}
                    className="px-5 py-2 rounded-xl bg-[#3168d8] text-white text-sm font-bold hover:bg-[#2552b0] disabled:opacity-60 flex items-center gap-2">
                    {saving && <Loader2 size={16} className="animate-spin" />} {saving ? 'Scheduling…' : 'Submit'}
                </button>
            </div>
        </form>
    );
}

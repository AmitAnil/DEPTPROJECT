"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, PlusCircle, ShieldCheck, Trash2, UserCheck, UserX } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';

interface StaffRow {
    id: string;
    full_name: string | null;
    email: string | null;
    designation: string | null;
    role: 'admin' | 'faculty';
    is_active: boolean | null;
    created_at: string | null;
}

interface AllowEntry {
    entry: string;
    note: string | null;
}

async function callApi(url: string, init: RequestInit): Promise<void> {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.error === 'string' ? body.error : `Request failed (${res.status})`);
    }
}

/** Admin: staff accounts (roles, activation) and who may sign up. */
export default function UserManagement({ currentUserId }: { currentUserId: string | null }) {
    const [supabase] = useState(createClient);
    const [staff, setStaff] = useState<StaffRow[]>([]);
    const [allow, setAllow] = useState<AllowEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    // True while the sign-up rules shown may be out of date (last load failed).
    const [allowStale, setAllowStale] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [filter, setFilter] = useState('');
    const [newEntry, setNewEntry] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        const problems: string[] = [];
        const [profilesRes, allowRes] = await Promise.all([
            supabase.from('profiles').select('id, full_name, email, designation, role, is_active, created_at').order('full_name'),
            fetch('/api/admin/signup-allowlist')
                .then(async (r) => (r.ok ? ((await r.json()) as { entries?: AllowEntry[] }) : Promise.reject(new Error(`HTTP ${r.status}`))))
                .catch((e: unknown) => e instanceof Error ? e : new Error(String(e))),
        ]);
        // Never show a failed load as an empty list (an empty allow-list means "anyone can sign up").
        if (profilesRes.error) problems.push(`staff list (${profilesRes.error.message})`);
        else setStaff((profilesRes.data as StaffRow[]) ?? []);
        if (allowRes instanceof Error) {
            problems.push(`sign-up rules (${allowRes.message})`);
            setAllowStale(true);
        } else {
            setAllow(allowRes.entries ?? []);
            setAllowStale(false);
        }
        setLoadError(problems.length ? `Could not load the ${problems.join(' and the ')}.` : null);
        setLoading(false);
    }, [supabase]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
        void load();
    }, [load]);

    const update = async (row: StaffRow, patch: { role?: 'admin' | 'faculty'; active?: boolean }, question: string) => {
        if (!confirm(question)) return;
        setBusy(row.id);
        try {
            await callApi(`/api/admin/users/${row.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
            await load();
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Update failed.');
        } finally {
            setBusy(null);
        }
    };

    const addEntry = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newEntry.trim()) return;
        setBusy('allow');
        try {
            await callApi('/api/admin/signup-allowlist', { method: 'POST', body: JSON.stringify({ entry: newEntry }) });
            setNewEntry('');
            await load();
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Could not add.');
        } finally {
            setBusy(null);
        }
    };

    const removeEntry = async (entry: string) => {
        // The "last rule" warning depends on an accurate list.
        if (allowStale) return;
        if (allow.length === 1 && !confirm('This is the last rule. With an empty list ANYONE can sign up. Continue?')) return;
        if (allow.length > 1 && !confirm(`Stop allowing sign-ups for "${entry}"? Existing accounts are not affected.`)) return;
        setBusy('allow');
        try {
            await callApi(`/api/admin/signup-allowlist?entry=${encodeURIComponent(entry)}`, { method: 'DELETE' });
            await load();
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Could not remove.');
        } finally {
            setBusy(null);
        }
    };

    const q = filter.trim().toLowerCase();
    const shown = staff.filter((s) => !q || `${s.full_name} ${s.email} ${s.designation}`.toLowerCase().includes(q));

    if (loading) return <p className="p-10 text-center text-gray-400">Loading…</p>;

    return (
        <div className="p-6 space-y-10">
            {loadError && (
                <div role="alert" className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 flex justify-between items-center gap-4">
                    <span>{loadError} The lists below may be incomplete.</span>
                    <button onClick={() => void load()} className="px-3 py-1.5 rounded-lg bg-white border border-red-200 font-bold hover:bg-red-100">Retry</button>
                </div>
            )}
            <section className="space-y-4">
                <div className="flex flex-wrap justify-between items-center gap-3">
                    <h2 className="text-lg font-bold text-gray-900">Staff accounts ({staff.length})</h2>
                    <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search name or email…"
                        className="p-2 border rounded-lg text-sm bg-gray-50 outline-none focus:ring-2 focus:ring-[#3b5998]" />
                </div>
                <div className="overflow-x-auto border border-gray-100 rounded-xl">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
                            <tr><th className="p-3">Name</th><th className="p-3">Email</th><th className="p-3">Role</th><th className="p-3">Status</th><th className="p-3 text-right">Actions</th></tr>
                        </thead>
                        <tbody>
                            {shown.map((s) => {
                                const isMe = s.id === currentUserId;
                                const active = s.is_active !== false;
                                return (
                                    <tr key={s.id} className="border-t border-gray-100">
                                        <td className="p-3">
                                            <p className="font-semibold text-gray-900">{s.full_name || '—'}{isMe && <span className="text-gray-400 font-normal"> (you)</span>}</p>
                                            <p className="text-xs text-gray-400">{s.designation}</p>
                                        </td>
                                        <td className="p-3 text-gray-600">{s.email}</td>
                                        <td className="p-3">
                                            {s.role === 'admin'
                                                ? <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-xs font-bold">Admin</span>
                                                : <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-bold">Faculty</span>}
                                        </td>
                                        <td className="p-3">
                                            {active
                                                ? <span className="text-green-700 text-xs font-bold">Active</span>
                                                : <span className="text-red-600 text-xs font-bold">Deactivated</span>}
                                        </td>
                                        <td className="p-3">
                                            <div className="flex justify-end gap-2">
                                                {busy === s.id ? <Loader2 size={16} className="animate-spin text-gray-400" /> : isMe ? null : (
                                                    <>
                                                        {s.role === 'admin' ? (
                                                            <button onClick={() => update(s, { role: 'faculty' }, `Remove admin rights from ${s.full_name || s.email}?`)}
                                                                className="px-3 py-1 text-xs font-bold rounded-lg border hover:bg-gray-50">Remove admin</button>
                                                        ) : (
                                                            <button onClick={() => update(s, { role: 'admin' }, `Make ${s.full_name || s.email} an admin? Admins can see and approve every report.`)}
                                                                className="px-3 py-1 text-xs font-bold rounded-lg border border-purple-200 text-purple-700 hover:bg-purple-50 flex items-center gap-1"><ShieldCheck size={12} /> Make admin</button>
                                                        )}
                                                        {active ? (
                                                            <button onClick={() => update(s, { active: false }, `Deactivate ${s.full_name || s.email}? They will be signed out and cannot sign in. Their reports are kept.`)}
                                                                className="px-3 py-1 text-xs font-bold rounded-lg border border-red-200 text-red-600 hover:bg-red-50 flex items-center gap-1"><UserX size={12} /> Deactivate</button>
                                                        ) : (
                                                            <button onClick={() => update(s, { active: true }, `Reactivate ${s.full_name || s.email}?`)}
                                                                className="px-3 py-1 text-xs font-bold rounded-lg border border-green-200 text-green-700 hover:bg-green-50 flex items-center gap-1"><UserCheck size={12} /> Reactivate</button>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <p className="text-xs text-gray-400">Deactivating keeps all reports; reassign drafts with &quot;Assign Tasks&quot; if needed. You cannot change your own account. There must always be one active admin.</p>
            </section>

            <section className="space-y-4">
                <h2 className="text-lg font-bold text-gray-900">Who can sign up</h2>
                <p className="text-sm text-gray-500">Email domains (sub-domains included) or individual addresses. If the list is empty, anyone can create an account.</p>
                <ul className="divide-y divide-gray-100 border border-gray-100 rounded-xl">
                    {allow.length === 0 && !loadError && <li className="p-3 text-sm text-orange-700 bg-orange-50">The list is empty: anyone can sign up.</li>}
                    {allow.map((a) => (
                        <li key={a.entry} className="p-3 flex justify-between items-center text-sm">
                            <span><span className="font-mono">{a.entry}</span>{a.note && <span className="text-gray-400"> · {a.note}</span>}</span>
                            <button onClick={() => removeEntry(a.entry)} disabled={busy === 'allow' || allowStale} title={allowStale ? 'Reload the list before removing rules' : 'Remove'} className="p-1.5 text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
                        </li>
                    ))}
                </ul>
                <form onSubmit={addEntry} className="flex gap-2">
                    <input value={newEntry} onChange={(e) => setNewEntry(e.target.value)} placeholder="christuniversity.in or guest.lecturer@gmail.com"
                        className="flex-1 p-2 border rounded-lg text-sm bg-gray-50 outline-none focus:ring-2 focus:ring-[#3b5998]" />
                    <button type="submit" disabled={busy === 'allow'} className="px-4 py-2 bg-[#3b5998] text-white rounded-lg text-sm font-bold flex items-center gap-2 disabled:opacity-50">
                        <PlusCircle size={16} /> Allow
                    </button>
                </form>
            </section>
        </div>
    );
}

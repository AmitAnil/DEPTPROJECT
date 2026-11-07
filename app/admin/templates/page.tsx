"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, CheckCircle2, LayoutTemplate, Loader2, RotateCcw, Save, Trash2 } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import LivePreview from '@/components/LivePreview';
import TemplateEditor from '@/components/template/TemplateEditor';
import { logActivity } from '@/lib/logger';
import { DEFAULT_TEMPLATE, parseTemplate, sampleData, validateTemplate, type ReportTemplate } from '@/lib/template';

interface VersionRow {
    id: string;
    name: string;
    is_active: boolean;
    created_at: string;
    definition: unknown;
}

const clone = (t: ReportTemplate): ReportTemplate => JSON.parse(JSON.stringify(t));
const formatTime = (s: string) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(s));

/**
 * Admin page for the report format. Each save creates a new, immutable version;
 * the active version is used for new reports, and existing reports keep theirs.
 */
export default function TemplatesPage() {
    const router = useRouter();
    const [supabase] = useState(createClient);
    const [versions, setVersions] = useState<VersionRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [draft, setDraft] = useState<ReportTemplate>(() => clone(DEFAULT_TEMPLATE));
    const [baseLabel, setBaseLabel] = useState('built-in format');
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [activateOnSave, setActivateOnSave] = useState(true);
    const [migrationMissing, setMigrationMissing] = useState(false);

    const validation = useMemo(() => validateTemplate(draft), [draft]);
    // Preview uses placeholder data; debounced by LivePreview itself.
    const preview = useMemo(() => ({ template: validation.template, data: sampleData(validation.template) }), [validation.template]);
    const activeVersion = versions.find((v) => v.is_active) ?? null;

    const loadVersions = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('report_templates')
            .select('id, name, is_active, created_at, definition')
            .order('created_at', { ascending: false });
        if (error) {
            console.error(error);
            setMigrationMissing(true);
        } else {
            setVersions(data as VersionRow[]);
        }
        setLoading(false);
        return (data as VersionRow[] | null) ?? [];
    }, [supabase]);

    useEffect(() => {
        let first = true;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
        void loadVersions().then((rows) => {
            if (!first) return;
            first = false;
            const active = rows.find((v) => v.is_active);
            if (active) {
                setDraft(clone(parseTemplate(active.definition)));
                setBaseLabel(`"${active.name}" (active)`);
            }
        });
    }, [loadVersions]);

    const edit = (next: ReportTemplate) => {
        setDraft(next);
        setDirty(true);
    };

    const startFrom = (template: ReportTemplate, label: string) => {
        if (dirty && !confirm('Discard your unsaved changes?')) return;
        setDraft(clone(template));
        setBaseLabel(label);
        setDirty(false);
    };

    const save = async () => {
        if (!validation.ok) return;
        setSaving(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Your session has expired.');
            const { data, error } = await supabase
                .from('report_templates')
                .insert({ name: validation.template.name, definition: validation.template, created_by: user.id, is_active: false })
                .select('id')
                .single();
            if (error) throw error;
            if (activateOnSave) {
                const { error: rpcError } = await supabase.rpc('activate_report_template', { template_id: data.id });
                if (rpcError) throw rpcError;
            }
            await logActivity('TEMPLATE_SAVED', `saved report format "${validation.template.name}"${activateOnSave ? ' and made it active' : ''}`, data.id);
            setDirty(false);
            setBaseLabel(`"${validation.template.name}"`);
            await loadVersions();
            alert(activateOnSave ? 'Saved. New reports now use this format.' : 'Saved as an inactive version.');
        } catch (err) {
            alert(`Could not save: ${err instanceof Error ? err.message : 'unknown error'}`);
        } finally {
            setSaving(false);
        }
    };

    const activate = async (id: string | null, name: string) => {
        if (!confirm(`Use "${name}" for all NEW reports? Existing reports keep their own format.`)) return;
        const { error } = await supabase.rpc('activate_report_template', { template_id: id });
        if (error) return alert(`Could not activate: ${error.message}`);
        await logActivity('TEMPLATE_ACTIVATED', `made report format "${name}" active`, id ?? undefined);
        await loadVersions();
    };

    const remove = async (v: VersionRow) => {
        if (!confirm(`Delete the version "${v.name}" from ${formatTime(v.created_at)}?`)) return;
        const { error } = await supabase.from('report_templates').delete().eq('id', v.id);
        if (error) {
            return alert(error.code === '23503' ? 'This version is used by existing reports and cannot be deleted.' : `Could not delete: ${error.message}`);
        }
        await loadVersions();
    };

    return (
        <div className="min-h-screen bg-[#F4F7FE] text-black">
            <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center sticky top-0 z-40">
                <div className="flex items-center gap-4">
                    <button onClick={() => router.push('/admin')} className="p-2 bg-gray-50 text-gray-500 rounded-full hover:bg-gray-200" title="Back to admin">
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h1 className="text-lg font-black text-[#112a53] flex items-center gap-2"><LayoutTemplate size={20} /> Report Format</h1>
                        <p className="text-xs text-gray-500">Editing a copy of the {baseLabel}{dirty ? ' (unsaved changes)' : ''}</p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-sm text-gray-600">
                        <input type="checkbox" checked={activateOnSave} onChange={(e) => setActivateOnSave(e.target.checked)} />
                        Use for new reports
                    </label>
                    <button onClick={save} disabled={!validation.ok || saving || migrationMissing}
                        className="px-5 py-2.5 bg-green-600 text-white rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-green-700 disabled:opacity-40">
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save as new version
                    </button>
                </div>
            </header>

            {migrationMissing && (
                <div className="max-w-7xl mx-auto mt-6 px-6">
                    <div className="p-4 rounded-xl bg-orange-50 border border-orange-200 text-orange-800 text-sm">
                        The <code>report_templates</code> table is missing. Apply the database migrations (see docs/DEPLOYMENT.md) to save formats. Until then the built-in format is used.
                    </div>
                </div>
            )}

            <main className="max-w-7xl mx-auto p-6 grid grid-cols-1 xl:grid-cols-5 gap-6">
                <div className="xl:col-span-3 space-y-6">
                    <div className="p-4 rounded-xl bg-blue-50 border border-blue-100 text-sm text-blue-900">
                        Changes apply to <b>new</b> reports only. Reports already created keep the format they were created with, so their PDFs never change.
                        Deleting a field hides it from new reports; nothing is deleted from old ones.
                    </div>

                    {!validation.ok && (
                        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800">
                            <p className="font-bold flex items-center gap-2 mb-1"><AlertTriangle size={16} /> Fix these before saving:</p>
                            <ul className="list-disc ml-5 space-y-0.5">{validation.errors.slice(0, 12).map((e, i) => <li key={i}>{e}</li>)}</ul>
                        </div>
                    )}

                    <TemplateEditor value={draft} onChange={edit} />
                </div>

                <aside className="xl:col-span-2 space-y-6">
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 xl:sticky xl:top-24">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">PDF preview (sample data)</p>
                        <div className="h-[60vh] rounded-xl overflow-hidden border border-gray-200">
                            <LivePreview data={preview.data} template={preview.template} />
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Versions</p>
                        {loading ? (
                            <p className="text-sm text-gray-400">Loading…</p>
                        ) : (
                            <ul className="divide-y divide-gray-100">
                                {versions.map((v) => (
                                    <li key={v.id} className="py-3 flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-gray-900 truncate flex items-center gap-2">
                                                {v.name} {v.is_active && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-bold">ACTIVE</span>}
                                            </p>
                                            <p className="text-xs text-gray-400">{formatTime(v.created_at)}</p>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <button onClick={() => startFrom(parseTemplate(v.definition), `"${v.name}"`)} className="px-3 py-1 text-xs font-bold rounded-lg border hover:bg-gray-50">Edit copy</button>
                                            {!v.is_active && (
                                                <>
                                                    <button onClick={() => activate(v.id, v.name)} className="px-3 py-1 text-xs font-bold rounded-lg border border-green-200 text-green-700 hover:bg-green-50">Activate</button>
                                                    <button onClick={() => remove(v)} title="Delete version" className="p-1.5 text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
                                                </>
                                            )}
                                        </div>
                                    </li>
                                ))}
                                <li className="py-3 flex items-center justify-between gap-2">
                                    <div>
                                        <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                                            Built-in format {!activeVersion && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-bold">ACTIVE</span>}
                                        </p>
                                        <p className="text-xs text-gray-400">Shipped with DeptDocs</p>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button onClick={() => startFrom(DEFAULT_TEMPLATE, 'built-in format')} className="px-3 py-1 text-xs font-bold rounded-lg border hover:bg-gray-50 flex items-center gap-1"><RotateCcw size={12} /> Edit copy</button>
                                        {activeVersion && (
                                            <button onClick={() => activate(null, 'Built-in format')} className="px-3 py-1 text-xs font-bold rounded-lg border border-green-200 text-green-700 hover:bg-green-50 flex items-center gap-1"><CheckCircle2 size={12} /> Activate</button>
                                        )}
                                    </div>
                                </li>
                            </ul>
                        )}
                    </div>
                </aside>
            </main>
        </div>
    );
}

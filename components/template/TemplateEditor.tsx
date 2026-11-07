"use client";

import React, { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, PlusCircle, Trash2 } from 'lucide-react';
import {
    FIELD_TYPES, FIELD_TYPE_LABELS, LIST_PDF_LAYOUTS, SECTION_ICONS, SUBFIELD_TYPES, SUBFIELD_TYPE_LABELS, slugifyId,
    type FieldType, type ReportTemplate, type TemplateField, type TemplateSection, type TemplateSubfield,
} from '@/lib/template';
import { iconFor } from '@/components/sectionIcons';

const input = 'w-full p-2 border rounded-lg bg-white text-sm outline-none focus:ring-2 focus:ring-[#3b5998]';
const small = 'text-[11px] font-bold text-gray-500 uppercase tracking-wider';

function move<T>(arr: T[], index: number, delta: number): T[] {
    const target = index + delta;
    if (target < 0 || target >= arr.length) return arr;
    const next = [...arr];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
}

const linesToList = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);

function takenIds(t: ReportTemplate): Set<string> {
    const s = new Set<string>();
    for (const sec of t.sections) for (const f of sec.fields) { s.add(f.id); if (f.endId) s.add(f.endId); }
    return s;
}

function newField(type: FieldType, taken: Set<string>): TemplateField {
    const label = FIELD_TYPE_LABELS[type].replace(/ \(.*\)$/, '');
    const id = slugifyId(label, taken);
    const field: TemplateField = { id, label, type };
    if (type === 'select') field.options = ['Option 1', 'Option 2'];
    if (type === 'dateRange' || type === 'timeRange') field.endId = slugifyId(`${id} end`, new Set([...taken, id]));
    if (type === 'list') {
        field.itemLabel = 'Item';
        field.pdfLayout = 'cards';
        field.subfields = [{ id: 'name', label: 'Name', type: 'text' }];
    }
    if (type === 'table') {
        field.subfields = [{ id: 'item', label: 'Item', type: 'text' }, { id: 'amount', label: 'Amount', type: 'number' }];
        field.showTotals = true;
    }
    return field;
}

interface Props {
    value: ReportTemplate;
    onChange: (next: ReportTemplate) => void;
}

export default function TemplateEditor({ value, onChange }: Props) {
    const [openSection, setOpenSection] = useState<number | null>(0);
    const [openField, setOpenField] = useState<string | null>(null);
    // Ids still derived from the label (fields added in this editing session).
    const [autoIds, setAutoIds] = useState<Set<string>>(new Set());

    const setSections = (sections: TemplateSection[]) => onChange({ ...value, sections });
    const updateSection = (si: number, patch: Partial<TemplateSection>) =>
        setSections(value.sections.map((s, i) => (i === si ? { ...s, ...patch } : s)));
    const updateField = (si: number, fi: number, patch: Partial<TemplateField>) =>
        updateSection(si, { fields: value.sections[si].fields.map((f, i) => (i === fi ? { ...f, ...patch } : f)) });

    const renameField = (si: number, fi: number, label: string) => {
        const field = value.sections[si].fields[fi];
        if (!autoIds.has(field.id)) return updateField(si, fi, { label });
        const taken = takenIds(value);
        taken.delete(field.id);
        if (field.endId) taken.delete(field.endId);
        const id = slugifyId(label || 'field', taken);
        const endId = field.endId ? slugifyId(`${id} end`, new Set([...taken, id])) : undefined;
        const next = new Set(autoIds);
        next.delete(field.id);
        next.add(id);
        setAutoIds(next);
        setOpenField(`${si}:${id}`);
        updateField(si, fi, { label, id, ...(endId ? { endId } : {}) });
    };

    /** Manual edit of a new field's data id: keeps it editable and its panel open. */
    const changeFieldId = (si: number, fi: number, id: string) => {
        const field = value.sections[si].fields[fi];
        const next = new Set(autoIds);
        next.delete(field.id);
        next.add(id);
        setAutoIds(next);
        setOpenField(`${si}:${id}`);
        updateField(si, fi, { id });
    };

    const addSection = () => {
        const taken = new Set(value.sections.map((s) => s.id));
        const fieldTaken = takenIds(value);
        const f = newField('text', fieldTaken);
        setAutoIds(new Set([...autoIds, f.id]));
        setSections([...value.sections, { id: slugifyId('New section', taken), title: 'New section', icon: 'file-text', fields: [f] }]);
        setOpenSection(value.sections.length);
    };

    const addField = (si: number, type: FieldType) => {
        const f = newField(type, takenIds(value));
        setAutoIds(new Set([...autoIds, f.id]));
        updateSection(si, { fields: [...value.sections[si].fields, f] });
        setOpenField(`${si}:${f.id}`);
    };

    // Reuse an existing repeating group (e.g. show speakers again for bios/photos).
    const existingLists = value.sections.flatMap((s) => s.fields).filter((f) => f.type === 'list')
        .filter((f, i, arr) => arr.findIndex((x) => x.id === f.id) === i);

    return (
        <div className="space-y-8">
            {/* Template-level settings */}
            <div className="bg-white border border-gray-100 rounded-2xl p-6 space-y-4 shadow-sm">
                <h3 className="font-bold text-gray-900">Report header</h3>
                <div className="grid md:grid-cols-2 gap-4">
                    <label className="space-y-1">
                        <span className={small}>Format name (for admins)</span>
                        <input className={input} value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
                    </label>
                    <label className="space-y-1">
                        <span className={small}>Title printed on the report</span>
                        <input className={input} value={value.header.title} onChange={(e) => onChange({ ...value, header: { ...value.header, title: e.target.value } })} />
                    </label>
                </div>
                <label className="space-y-1 block">
                    <span className={small}>Header lines (one per line: university, school, department…)</span>
                    <textarea rows={3} className={input} value={value.header.lines.join('\n')}
                        onChange={(e) => onChange({ ...value, header: { ...value.header, lines: e.target.value.split('\n') } })} />
                </label>
            </div>

            {/* Sections */}
            <div className="space-y-4">
                {value.sections.map((section, si) => {
                    const Icon = iconFor(section.icon);
                    const open = openSection === si;
                    return (
                        <div key={`${section.id}-${si}`} className="bg-white border border-gray-100 rounded-2xl shadow-sm">
                            <div className="flex items-center gap-3 p-4">
                                <button type="button" onClick={() => setOpenSection(open ? null : si)} className="flex-1 flex items-center gap-3 text-left">
                                    {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                    <Icon size={18} className="text-[#3b5998]" />
                                    <span className="font-bold text-gray-900">{si + 1}. {section.title || 'Untitled section'}</span>
                                    <span className="text-xs text-gray-400">{section.fields.length} field{section.fields.length === 1 ? '' : 's'}{section.newPage ? ' · new page' : ''}</span>
                                </button>
                                <button type="button" title="Move up" onClick={() => setSections(move(value.sections, si, -1))} className="p-1.5 text-gray-400 hover:text-gray-800"><ArrowUp size={16} /></button>
                                <button type="button" title="Move down" onClick={() => setSections(move(value.sections, si, 1))} className="p-1.5 text-gray-400 hover:text-gray-800"><ArrowDown size={16} /></button>
                                <button type="button" title="Delete section" onClick={() => {
                                    if (confirm(`Delete the section "${section.title}"? Reports created with older versions are not affected.`)) {
                                        setSections(value.sections.filter((_, i) => i !== si));
                                    }
                                }} className="p-1.5 text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
                            </div>

                            {open && (
                                <div className="border-t border-gray-100 p-5 space-y-5">
                                    <div className="grid md:grid-cols-2 gap-4">
                                        <label className="space-y-1">
                                            <span className={small}>Section title (sidebar)</span>
                                            <input className={input} value={section.title} onChange={(e) => updateSection(si, { title: e.target.value })} />
                                        </label>
                                        <label className="space-y-1">
                                            <span className={small}>Icon</span>
                                            <select className={input} value={section.icon ?? 'file-text'} onChange={(e) => updateSection(si, { icon: e.target.value as TemplateSection['icon'] })}>
                                                {SECTION_ICONS.map((ic) => <option key={ic} value={ic}>{ic}</option>)}
                                            </select>
                                        </label>
                                        <label className="space-y-1">
                                            <span className={small}>Heading in the PDF (optional)</span>
                                            <input className={input} value={section.pdfTitle ?? ''} placeholder={section.title} onChange={(e) => updateSection(si, { pdfTitle: e.target.value || undefined })} />
                                        </label>
                                        <label className="space-y-1">
                                            <span className={small}>Line under the heading (optional)</span>
                                            <input className={input} value={section.pdfSubtitle ?? ''} placeholder="e.g. ({{activityType}} - {{date}})" onChange={(e) => updateSection(si, { pdfSubtitle: e.target.value || undefined })} />
                                        </label>
                                    </div>
                                    <label className="flex items-center gap-2 text-sm text-gray-700">
                                        <input type="checkbox" checked={!!section.newPage} onChange={(e) => updateSection(si, { newPage: e.target.checked || undefined })} />
                                        Start this section on a new page in the PDF
                                    </label>

                                    {/* Fields */}
                                    <div className="space-y-2">
                                        <span className={small}>Fields</span>
                                        {section.fields.map((field, fi) => (
                                            <FieldEditor
                                                key={fi}
                                                field={field}
                                                open={openField === `${si}:${field.id}`}
                                                onToggle={() => setOpenField(openField === `${si}:${field.id}` ? null : `${si}:${field.id}`)}
                                                onChange={(patch) => updateField(si, fi, patch)}
                                                onRename={(label) => renameField(si, fi, label)}
                                                onChangeId={(id) => changeFieldId(si, fi, id)}
                                                onMove={(d) => updateSection(si, { fields: move(section.fields, fi, d) })}
                                                onDelete={() => updateSection(si, { fields: section.fields.filter((_, i) => i !== fi) })}
                                                idEditable={autoIds.has(field.id)}
                                            />
                                        ))}
                                        <div className="flex flex-wrap items-center gap-3 pt-2">
                                            <select className={`${input} w-auto`} value="" onChange={(e) => { if (e.target.value) addField(si, e.target.value as FieldType); }}>
                                                <option value="">+ Add field…</option>
                                                {FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}
                                            </select>
                                            {existingLists.length > 0 && (
                                                <select className={`${input} w-auto`} value="" onChange={(e) => {
                                                    const src = existingLists.find((l) => l.id === e.target.value);
                                                    if (src) updateSection(si, { fields: [...section.fields, { ...src, fixedItems: true, label: `${src.label} (more details)`, subfields: [{ id: 'notes', label: 'Notes', type: 'textarea' }] }] });
                                                }}>
                                                    <option value="">+ Show an existing group again…</option>
                                                    {existingLists.map((l) => <option key={l.id} value={l.id}>{l.label} ({l.id})</option>)}
                                                </select>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
                <button type="button" onClick={addSection} className="flex items-center gap-2 text-[#3b5998] font-bold text-sm hover:underline">
                    <PlusCircle size={18} /> Add section
                </button>
            </div>
        </div>
    );
}

interface FieldEditorProps {
    field: TemplateField;
    open: boolean;
    idEditable: boolean;
    onToggle: () => void;
    onChange: (patch: Partial<TemplateField>) => void;
    onRename: (label: string) => void;
    onChangeId: (id: string) => void;
    onMove: (delta: number) => void;
    onDelete: () => void;
}

function FieldEditor({ field, open, idEditable, onToggle, onChange, onRename, onChangeId, onMove, onDelete }: FieldEditorProps) {
    return (
        <div className="border border-gray-100 rounded-xl bg-gray-50/50">
            <div className="flex items-center gap-2 px-3 py-2">
                <button type="button" onClick={onToggle} className="flex-1 flex items-center gap-2 text-left text-sm">
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span className="font-semibold text-gray-800">{field.label || 'Untitled field'}</span>
                    {field.required && <span className="text-red-500">*</span>}
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-[#3b5998] font-bold">{FIELD_TYPE_LABELS[field.type]}</span>
                    <code className="text-[10px] text-gray-400">{field.id}</code>
                </button>
                <button type="button" title="Move up" onClick={() => onMove(-1)} className="p-1 text-gray-400 hover:text-gray-800"><ArrowUp size={14} /></button>
                <button type="button" title="Move down" onClick={() => onMove(1)} className="p-1 text-gray-400 hover:text-gray-800"><ArrowDown size={14} /></button>
                <button type="button" title="Delete field" onClick={onDelete} className="p-1 text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
            </div>

            {open && (
                <div className="border-t border-gray-100 p-4 grid md:grid-cols-2 gap-4">
                    <label className="space-y-1">
                        <span className={small}>Label</span>
                        <input className={input} value={field.label} onChange={(e) => onRename(e.target.value)} />
                    </label>
                    <label className="space-y-1">
                        <span className={small}>Data id {idEditable ? '' : '(fixed: existing data uses it)'}</span>
                        <input className={`${input} font-mono`} value={field.id} disabled={!idEditable} onChange={(e) => onChangeId(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} />
                    </label>
                    <label className="space-y-1">
                        <span className={small}>Field type</span>
                        <select className={input} value={field.type} onChange={(e) => {
                            const type = e.target.value as FieldType;
                            const patch: Partial<TemplateField> = { type };
                            if (type === 'select' && !field.options?.length) patch.options = ['Option 1'];
                            if ((type === 'dateRange' || type === 'timeRange') && !field.endId) patch.endId = `${field.id}End`;
                            if (type === 'list' && !field.subfields?.length) Object.assign(patch, { subfields: [{ id: 'name', label: 'Name', type: 'text' }], itemLabel: 'Item', pdfLayout: 'cards' });
                            if (type === 'table') Object.assign(patch, { subfields: (field.subfields?.length ? field.subfields : [{ id: 'item', label: 'Item', type: 'text' }]).filter((sf) => sf.type !== 'image') });
                            onChange(patch);
                        }}>
                            {FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}
                        </select>
                    </label>
                    <label className="space-y-1">
                        <span className={small}>Label in the PDF (optional)</span>
                        <input className={input} value={field.pdfLabel ?? ''} placeholder={field.label} onChange={(e) => onChange({ pdfLabel: e.target.value || undefined })} />
                    </label>
                    <label className="space-y-1 md:col-span-2">
                        <span className={small}>Help text (optional, shown under the label; also guides the AI)</span>
                        <input className={input} value={field.help ?? ''} onChange={(e) => onChange({ help: e.target.value || undefined })} />
                    </label>
                    {['text', 'textarea', 'number'].includes(field.type) && (
                        <label className="space-y-1">
                            <span className={small}>Placeholder</span>
                            <input className={input} value={field.placeholder ?? ''} onChange={(e) => onChange({ placeholder: e.target.value || undefined })} />
                        </label>
                    )}
                    {field.type === 'select' && (
                        <label className="space-y-1 md:col-span-2">
                            <span className={small}>Options (one per line)</span>
                            <textarea rows={4} className={input} value={(field.options ?? []).join('\n')} onChange={(e) => onChange({ options: e.target.value.split('\n') })}
                                onBlur={(e) => onChange({ options: linesToList(e.target.value) })} />
                        </label>
                    )}
                    {field.type === 'table' && (
                        <>
                            <label className="space-y-1 md:col-span-2">
                                <span className={small}>Fixed row labels (one per line, optional). Leave empty to let people add rows.</span>
                                <textarea rows={3} className={input} placeholder={'e.g.\nRegistration fees\nHonorarium\nRefreshments'} value={(field.rowLabels ?? []).join('\n')}
                                    onChange={(e) => onChange({ rowLabels: e.target.value ? e.target.value.split('\n') : undefined })}
                                    onBlur={(e) => { const l = linesToList(e.target.value); onChange({ rowLabels: l.length ? l : undefined }); }} />
                            </label>
                            {field.rowLabels && (
                                <label className="space-y-1">
                                    <span className={small}>Header above the row labels</span>
                                    <input className={input} value={field.rowHeader ?? ''} placeholder="e.g. Budget head" onChange={(e) => onChange({ rowHeader: e.target.value || undefined })} />
                                </label>
                            )}
                            <SubfieldsEditor subfields={field.subfields ?? []} onChange={(subfields) => onChange({ subfields })} allowImages={false} title="Table columns" />
                        </>
                    )}
                    {(field.type === 'list' || field.type === 'photos' || (field.type === 'table' && !field.rowLabels)) && (
                        <label className="space-y-1">
                            <span className={small}>Minimum number of {field.type === 'photos' ? 'photos' : field.type === 'table' ? 'filled rows' : 'entries'}</span>
                            <input type="number" min={0} className={input} value={field.minItems ?? 0} onChange={(e) => onChange({ minItems: Number(e.target.value) || undefined })} />
                        </label>
                    )}
                    {field.type === 'list' && (
                        <>
                            <label className="space-y-1">
                                <span className={small}>Name of one entry</span>
                                <input className={input} value={field.itemLabel ?? ''} placeholder="e.g. Speaker" onChange={(e) => onChange({ itemLabel: e.target.value })} />
                            </label>
                            <label className="space-y-1">
                                <span className={small}>PDF layout</span>
                                <select className={input} value={field.pdfLayout ?? 'cards'} onChange={(e) => onChange({ pdfLayout: e.target.value as TemplateField['pdfLayout'] })}>
                                    {LIST_PDF_LAYOUTS.map((l) => <option key={l} value={l}>{l === 'cards' ? 'One table per entry' : l === 'table' ? 'Single table, one row per entry' : 'Profile (photo + paragraph)'}</option>)}
                                </select>
                            </label>
                            <SubfieldsEditor subfields={field.subfields ?? []} onChange={(subfields) => onChange({ subfields })} />
                        </>
                    )}
                    <div className="md:col-span-2 flex flex-wrap gap-5 text-sm text-gray-700">
                        <label className="flex items-center gap-2"><input type="checkbox" checked={!!field.required} onChange={(e) => onChange({ required: e.target.checked || undefined })} /> Required before submitting</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={!!field.hideInPdf} onChange={(e) => onChange({ hideInPdf: e.target.checked || undefined })} /> Hide in the PDF</label>
                        {field.type === 'textarea' && (
                            <label className="flex items-center gap-2"><input type="checkbox" checked={!!field.bullets} onChange={(e) => onChange({ bullets: e.target.checked || undefined })} /> Bullet-point button</label>
                        )}
                        {field.type === 'attachments' && (
                            <label className="flex items-center gap-2"><input type="checkbox" checked={!!field.allowSpreadsheets} onChange={(e) => onChange({ allowSpreadsheets: e.target.checked || undefined })} /> Allow Excel/CSV (printed as a table)</label>
                        )}
                        {field.type === 'table' && (
                            <label className="flex items-center gap-2"><input type="checkbox" checked={!!field.showTotals} onChange={(e) => onChange({ showTotals: e.target.checked || undefined })} /> Total row for number columns</label>
                        )}
                        {field.type === 'list' && (
                            <label className="flex items-center gap-2"><input type="checkbox" checked={!!field.fixedItems} onChange={(e) => onChange({ fixedItems: e.target.checked || undefined })} /> Entries are added in another section</label>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function SubfieldsEditor({ subfields, onChange, allowImages = true, title = 'Columns of each entry' }: {
    subfields: TemplateSubfield[];
    onChange: (next: TemplateSubfield[]) => void;
    allowImages?: boolean;
    title?: string;
}) {
    const update = (i: number, patch: Partial<TemplateSubfield>) => onChange(subfields.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    return (
        <div className="md:col-span-2 space-y-2">
            <span className={small}>{title}</span>
            {subfields.map((sf, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-start">
                    <input className={`${input} col-span-4`} value={sf.label} placeholder="Label"
                        onChange={(e) => update(i, { label: e.target.value })}
                        onBlur={(e) => { if (!sf.id) update(i, { id: slugifyId(e.target.value, new Set(subfields.map((s) => s.id))) }); }} />
                    <input className={`${input} col-span-3 font-mono`} value={sf.id} placeholder="id" onChange={(e) => update(i, { id: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })} />
                    <select className={`${input} col-span-3`} value={sf.type} onChange={(e) => update(i, { type: e.target.value as TemplateSubfield['type'], ...(e.target.value === 'select' && !sf.options?.length ? { options: ['Option 1'] } : {}) })}>
                        {SUBFIELD_TYPES.filter((t) => allowImages || t !== 'image').map((t) => <option key={t} value={t}>{SUBFIELD_TYPE_LABELS[t]}</option>)}
                    </select>
                    <div className="col-span-2 flex">
                        <button type="button" title="Duplicate" onClick={() => onChange([...subfields.slice(0, i + 1), { ...sf, id: slugifyId(sf.label || 'column', new Set(subfields.map((s) => s.id))) }, ...subfields.slice(i + 1)])} className="p-2 text-gray-400 hover:text-gray-800"><Copy size={14} /></button>
                        <button type="button" title="Remove column" onClick={() => onChange(subfields.filter((_, j) => j !== i))} className="p-2 text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
                    </div>
                    <input className={`${input} col-span-12 text-xs`} value={sf.pdfLabel ?? ''} placeholder={`Label in the PDF (optional, default: ${sf.label || 'label'})`}
                        onChange={(e) => update(i, { pdfLabel: e.target.value || undefined })} />
                    {sf.type === 'select' && (
                        <textarea rows={2} className={`${input} col-span-12`} placeholder="Options, one per line" value={(sf.options ?? []).join('\n')}
                            onChange={(e) => update(i, { options: e.target.value.split('\n') })} onBlur={(e) => update(i, { options: linesToList(e.target.value) })} />
                    )}
                </div>
            ))}
            <button type="button" onClick={() => onChange([...subfields, { id: slugifyId('column', new Set(subfields.map((s) => s.id))), label: 'New column', type: 'text' }])}
                className="text-[#3b5998] text-sm font-bold flex items-center gap-1"><PlusCircle size={14} /> Add column</button>
        </div>
    );
}

"use client";

import type { UploadFolder } from '@/lib/files';
import React, { useState } from 'react';
import { PlusCircle, Trash2, Upload, X } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { describeUploadError, resolveUploadFolder, uploadImage } from '@/lib/files';
import { newItemId } from '@/lib/reportData';
import { listValue, textValue, type ListItem, type ReportValues, type TemplateField, type TemplateSubfield } from '@/lib/template';
import StoredImage from '@/components/StoredImage';
import { FieldLabel, inputClass, labelClass } from './ScalarField';

interface Props {
    field: TemplateField;
    data: ReportValues;
    onUpdate: (patch: ReportValues) => void;
    uploadFolder?: UploadFolder;
}

/** Repeating group (speakers, participant groups, ...). Several sections may show different columns of the same list. */
export default function ListField({ field, data, onUpdate, uploadFolder }: Props) {
    const [supabase] = useState(createClient);
    const [uploading, setUploading] = useState<string | null>(null);
    const items = listValue(data, field.id);
    const subfields = field.subfields ?? [];
    const itemLabel = field.itemLabel || 'Item';

    const write = (next: ListItem[]) => onUpdate({ [field.id]: next });
    const updateItem = (id: ListItem['id'], key: string, value: string | null) =>
        write(items.map((it) => (it.id === id ? { ...it, [key]: value } : it)));
    const addItem = () => write([...items, { id: newItemId() }]);
    const removeItem = (id: ListItem['id']) => write(items.filter((it) => it.id !== id));

    const uploadPhoto = async (item: ListItem, sf: TemplateSubfield, file: File | undefined) => {
        if (!file || !uploadFolder) return;
        const key = `${item.id}-${sf.id}`;
        setUploading(key);
        try {
            const folder = await resolveUploadFolder(uploadFolder);
            if (!folder) throw new Error('Could not create the draft for this upload.');
            const ref = await uploadImage({ supabase, folder }, file, field.id);
            updateItem(item.id, sf.id, ref);
        } catch (err) {
            console.error('Photo upload failed:', err);
            alert(describeUploadError(err));
        } finally {
            setUploading(null);
        }
    };

    const renderSubfield = (item: ListItem, sf: TemplateSubfield) => {
        const value = textValue(item, sf.id);
        const inputId = `f-${field.id}-${item.id}-${sf.id}`;
        switch (sf.type) {
            case 'image':
                return (
                    <div key={sf.id} className="space-y-2">
                        <span className={labelClass}>{sf.label}{sf.required && <span className="text-red-500"> *</span>}</span>
                        {value ? (
                            <div className="relative group w-32 h-32 rounded-lg overflow-hidden border shadow-sm">
                                <StoredImage src={value} alt={sf.label} className="w-full h-full object-cover" />
                                <button type="button" onClick={() => updateItem(item.id, sf.id, null)} title="Remove photo"
                                    className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <X size={20} className="text-white" />
                                </button>
                            </div>
                        ) : (
                            <label className="relative border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center bg-white hover:border-[#4F65F6] cursor-pointer">
                                <input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" disabled={!uploadFolder || uploading !== null}
                                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void uploadPhoto(item, sf, f); }} />
                                <Upload size={20} className="text-gray-400 mb-2" />
                                <span className="bg-[#4F65F6] text-white px-5 py-1.5 rounded-full font-bold text-xs">
                                    {uploading === `${item.id}-${sf.id}` ? 'Uploading...' : 'Upload Photo'}
                                </span>
                            </label>
                        )}
                    </div>
                );
            case 'textarea':
                return (
                    <div key={sf.id} className="space-y-2">
                        <label htmlFor={inputId} className={labelClass}>{sf.label}{sf.required && <span className="text-red-500"> *</span>}</label>
                        <textarea id={inputId} rows={4} value={value} placeholder={sf.placeholder} onChange={(e) => updateItem(item.id, sf.id, e.target.value)}
                            className={`${inputClass} bg-white rounded-xl leading-relaxed`} />
                    </div>
                );
            case 'select':
                return (
                    <div key={sf.id} className="space-y-2">
                        <label htmlFor={inputId} className={labelClass}>{sf.label}{sf.required && <span className="text-red-500"> *</span>}</label>
                        <select id={inputId} value={value} onChange={(e) => updateItem(item.id, sf.id, e.target.value)} className={`${inputClass} bg-white`}>
                            <option value="">Select</option>
                            {(sf.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                            {value && !(sf.options ?? []).includes(value) && <option value={value}>{value}</option>}
                        </select>
                    </div>
                );
            default:
                return (
                    <div key={sf.id} className="space-y-2">
                        <label htmlFor={inputId} className={labelClass}>{sf.label}{sf.required && <span className="text-red-500"> *</span>}</label>
                        <input id={inputId} type={sf.type === 'number' ? 'number' : sf.type === 'date' ? 'date' : 'text'} min={sf.type === 'number' ? 0 : undefined}
                            list={sf.suggestions?.length ? `${inputId}-suggestions` : undefined}
                            value={value} placeholder={sf.placeholder} onChange={(e) => updateItem(item.id, sf.id, e.target.value)} className={`${inputClass} bg-white`} />
                        {sf.suggestions?.length ? (
                            <datalist id={`${inputId}-suggestions`}>{sf.suggestions.map((o) => <option key={o} value={o} />)}</datalist>
                        ) : null}
                    </div>
                );
        }
    };

    // The first text column names each card ("Speaker 1: Dr. A").
    const nameColumn = subfields.find((sf) => sf.type === 'text');

    return (
        <div className="space-y-6">
            <FieldLabel field={field} />
            {items.length === 0 && (
                <p className="text-sm text-gray-400 italic">
                    {field.fixedItems ? `No ${itemLabel.toLowerCase()}s yet. Add them in their own section first.` : `No ${itemLabel.toLowerCase()}s added yet.`}
                </p>
            )}
            {items.map((item, index) => (
                <div key={item.id} className="p-6 border border-gray-100 rounded-2xl bg-gray-50/50 space-y-4 shadow-sm">
                    <div className="flex justify-between items-center">
                        <h4 className="font-bold text-[#1a365d]">
                            {itemLabel} {index + 1}{nameColumn && textValue(item, nameColumn.id) ? `: ${textValue(item, nameColumn.id)}` : ''}
                        </h4>
                        {!field.fixedItems && (
                            <button type="button" onClick={() => removeItem(item.id)} title={`Remove ${itemLabel.toLowerCase()}`}
                                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md">
                                <Trash2 size={16} />
                            </button>
                        )}
                    </div>
                    <div className={subfields.length > 2 ? 'space-y-4' : 'grid grid-cols-1 sm:grid-cols-2 gap-4'}>
                        {subfields.map((sf) => renderSubfield(item, sf))}
                    </div>
                </div>
            ))}
            {!field.fixedItems && (
                <button type="button" onClick={addItem} className="flex items-center gap-2 text-[#4F65F6] font-bold text-sm hover:underline">
                    <PlusCircle size={18} /> Add {itemLabel}
                </button>
            )}
        </div>
    );
}

"use client";

import React from 'react';
import { Calendar, Clock, List } from 'lucide-react';
import { textValue, type ReportValues, type TemplateField } from '@/lib/template';
import SelectOrOther from './SelectOrOther';

export const inputClass = 'w-full p-3 border rounded-lg bg-gray-50 outline-none focus:ring-2 focus:ring-[#4F65F6] text-sm';
export const labelClass = 'text-sm font-bold text-gray-700';

export function FieldLabel({ field, htmlFor }: { field: Pick<TemplateField, 'label' | 'required' | 'help'>; htmlFor?: string }) {
    return (
        <div>
            <label htmlFor={htmlFor} className={labelClass}>
                {field.label}
                {field.required && <span className="text-red-500"> *</span>}
            </label>
            {field.help && <p className="text-xs text-gray-400 mt-0.5">{field.help}</p>}
        </div>
    );
}

interface Props {
    field: TemplateField;
    data: ReportValues;
    onUpdate: (patch: ReportValues) => void;
}

/** Inputs for single-value fields: text, paragraph, number, date, time, ranges, dropdown. */
export default function ScalarField({ field, data, onUpdate }: Props) {
    const id = `f-${field.id}`;
    const value = textValue(data, field.id);
    const set = (key: string, v: string) => onUpdate({ [key]: v });

    switch (field.type) {
        case 'textarea': {
            const insertBullet = () => set(field.id, value + (value && !value.endsWith('\n') ? '\n• ' : '• '));
            return (
                <div className="space-y-2">
                    <div className="flex justify-between items-end">
                        <FieldLabel field={field} htmlFor={id} />
                        {field.bullets && (
                            <button type="button" onClick={insertBullet} title="Insert bullet point" className="p-1.5 rounded-md border bg-white text-gray-500 hover:text-[#4F65F6]">
                                <List size={14} />
                            </button>
                        )}
                    </div>
                    <textarea id={id} rows={4} value={value} placeholder={field.placeholder ?? `Enter ${field.label.toLowerCase()}...`}
                        onChange={(e) => set(field.id, e.target.value)} className={`${inputClass} rounded-xl leading-relaxed`} />
                </div>
            );
        }
        case 'select':
            return (
                <div className="space-y-2">
                    <FieldLabel field={field} htmlFor={id} />
                    <SelectOrOther id={id} value={value} options={field.options ?? []} onChange={(v) => set(field.id, v)}
                        placeholder={`Select ${field.label}`} selectClassName={inputClass} inputClassName={inputClass} />
                </div>
            );
        case 'dateRange':
        case 'timeRange': {
            const isDate = field.type === 'dateRange';
            const Icon = isDate ? Calendar : Clock;
            const endKey = field.endId ?? `${field.id}End`;
            return (
                <div className="space-y-2">
                    <FieldLabel field={field} />
                    <div className="grid grid-cols-2 gap-4">
                        {[{ key: field.id, label: isDate ? 'Start Date' : 'Start Time' }, { key: endKey, label: isDate ? 'End Date' : 'End Time' }].map((part) => (
                            <div key={part.key} className="space-y-1">
                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{part.label}</span>
                                <div className="relative">
                                    <input type={isDate ? 'date' : 'time'} value={textValue(data, part.key)} onChange={(e) => set(part.key, e.target.value)}
                                        className={`${inputClass} pr-9`} aria-label={`${field.label} ${part.label}`} />
                                    <Icon size={16} className="text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            );
        }
        default: {
            const type = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'time' ? 'time' : 'text';
            return (
                <div className="space-y-2">
                    <FieldLabel field={field} htmlFor={id} />
                    <input id={id} type={type} min={type === 'number' ? 0 : undefined} value={value} placeholder={field.placeholder}
                        list={field.suggestions?.length ? `${id}-suggestions` : undefined}
                        onChange={(e) => set(field.id, e.target.value)} className={inputClass} />
                    {field.suggestions?.length ? (
                        <datalist id={`${id}-suggestions`}>{field.suggestions.map((o) => <option key={o} value={o} />)}</datalist>
                    ) : null}
                </div>
            );
        }
    }
}

"use client";

import React from 'react';
import { PlusCircle, Trash2 } from 'lucide-react';
import { newItemId } from '@/lib/reportData';
import {
    TABLE_ROW_LABEL_KEY, tableRows, tableTotals, textValue,
    type ListItem, type ReportValues, type TemplateField, type TemplateSubfield,
} from '@/lib/template';
import { FieldLabel } from './ScalarField';

interface Props {
    field: TemplateField;
    data: ReportValues;
    onUpdate: (patch: ReportValues) => void;
}

const cell = 'w-full px-2 py-1.5 text-sm bg-transparent outline-none focus:bg-blue-50/60 rounded';

/** Spreadsheet-style grid: admin-defined columns, fixed or user-added rows, optional totals. */
export default function TableField({ field, data, onUpdate }: Props) {
    const columns = (field.subfields ?? []).filter((sf) => sf.type !== 'image');
    const rows = tableRows(field, data);
    const fixed = !!field.rowLabels;
    const totals = field.showTotals ? tableTotals(field, rows) : null;

    const write = (next: ListItem[]) => onUpdate({ [field.id]: next });
    const setCell = (rowIndex: number, key: string, value: string) =>
        write(rows.map((r, i) => (i === rowIndex ? { ...r, [key]: value } : r)));

    const input = (row: ListItem, rowIndex: number, sf: TemplateSubfield) => {
        const value = textValue(row, sf.id);
        const label = `${field.label}: ${fixed ? textValue(row, TABLE_ROW_LABEL_KEY) : `row ${rowIndex + 1}`}, ${sf.label}`;
        if (sf.type === 'select') {
            return (
                <select aria-label={label} className={cell} value={value} onChange={(e) => setCell(rowIndex, sf.id, e.target.value)}>
                    <option value=""></option>
                    {(sf.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
            );
        }
        if (sf.type === 'textarea') {
            return <textarea aria-label={label} rows={2} className={`${cell} resize-y`} value={value} onChange={(e) => setCell(rowIndex, sf.id, e.target.value)} />;
        }
        const listId = sf.suggestions?.length ? `t-${field.id}-${sf.id}-suggestions` : undefined;
        return (
            <>
                <input aria-label={label} className={`${cell} ${sf.type === 'number' ? 'text-right' : ''}`} value={value} placeholder={sf.placeholder}
                    type={sf.type === 'number' ? 'number' : sf.type === 'date' ? 'date' : 'text'} min={sf.type === 'number' ? 0 : undefined}
                    list={listId} onChange={(e) => setCell(rowIndex, sf.id, e.target.value)} />
                {listId && rowIndex === 0 && <datalist id={listId}>{sf.suggestions!.map((o) => <option key={o} value={o} />)}</datalist>}
            </>
        );
    };

    return (
        <div className="space-y-3">
            <FieldLabel field={field} />
            <div className="overflow-x-auto border border-gray-200 rounded-xl bg-white">
                <table className="w-full text-sm border-collapse">
                    <thead>
                        <tr className="bg-gray-50 text-left">
                            {fixed && <th className="px-3 py-2 font-bold text-gray-600 border-b border-r border-gray-200">{field.rowHeader || ''}</th>}
                            {columns.map((sf) => (
                                <th key={sf.id} className={`px-3 py-2 font-bold text-gray-600 border-b border-gray-200 ${sf.type === 'number' ? 'text-right' : ''}`}>{sf.label}</th>
                            ))}
                            {!fixed && <th className="w-10 border-b border-gray-200" />}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 && (
                            <tr><td colSpan={columns.length + 1} className="px-3 py-4 text-center text-gray-400 italic">No rows yet.</td></tr>
                        )}
                        {rows.map((row, ri) => (
                            <tr key={row.id} className="border-b border-gray-100 last:border-0">
                                {fixed && <th scope="row" className="px-3 py-1.5 text-left font-semibold text-gray-700 border-r border-gray-100 whitespace-nowrap">{textValue(row, TABLE_ROW_LABEL_KEY)}</th>}
                                {columns.map((sf) => <td key={sf.id} className="px-1 py-0.5 align-top">{input(row, ri, sf)}</td>)}
                                {!fixed && (
                                    <td className="px-1 text-center">
                                        <button type="button" title="Remove row" onClick={() => write(rows.filter((_, i) => i !== ri))} className="p-1 text-gray-400 hover:text-red-500">
                                            <Trash2 size={14} />
                                        </button>
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                    {totals && rows.length > 0 && (
                        <tfoot>
                            <tr className="bg-gray-50 font-bold">
                                {fixed && <td className="px-3 py-2 border-t border-r border-gray-200">Total</td>}
                                {columns.map((sf, i) => (
                                    <td key={sf.id} className={`px-3 py-2 border-t border-gray-200 ${sf.type === 'number' ? 'text-right' : ''}`}>
                                        {sf.type === 'number' ? totals[sf.id] : !fixed && i === 0 ? 'Total' : ''}
                                    </td>
                                ))}
                                {!fixed && <td className="border-t border-gray-200" />}
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
            {!fixed && (
                <button type="button" onClick={() => write([...rows, { id: newItemId() }])} className="flex items-center gap-2 text-[#4F65F6] font-bold text-sm hover:underline">
                    <PlusCircle size={16} /> Add row
                </button>
            )}
        </div>
    );
}

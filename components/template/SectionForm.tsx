"use client";

import type { UploadFolder } from '@/lib/files';
import React, { useEffect, useRef } from 'react';
import { AlertCircle, ChevronRight } from 'lucide-react';
import type { FieldProblem, ReportValues, TemplateField, TemplateSection } from '@/lib/template';
import ScalarField from './ScalarField';
import ListField from './ListField';
import TableField from './TableField';
import PhotosField from './PhotosField';
import AttachmentsField from './AttachmentsField';
import PreparedByField from './PreparedByField';

interface Props {
    section: TemplateSection;
    data: ReportValues;
    onUpdate: (patch: ReportValues) => void;
    uploadFolder?: UploadFolder;
    /** Next section, or undefined on the last one. */
    onNext?: () => void;
    /** Shown on the last section. */
    onFinish?: () => void;
    canFinish?: boolean;
    /** Missing fields to highlight (empty until the user tries to move on). */
    problems?: FieldProblem[];
    /** Changes on every blocked attempt, so the error list scrolls into view again. */
    errorTick?: number;
}

/** Renders one template section as a form. */
export default function SectionForm({ section, data, onUpdate, uploadFolder, onNext, onFinish, canFinish = true, problems = [], errorTick = 0 }: Props) {
    const summaryRef = useRef<HTMLDivElement>(null);
    const hasProblems = problems.length > 0;
    useEffect(() => {
        if (hasProblems) summaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Only when the user tries again, not on every keystroke.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [errorTick]);

    const problemsFor = (fieldId: string) => problems.filter((p) => p.fieldId === fieldId);

    return (
        <div className="space-y-8 animate-in fade-in duration-500 max-w-3xl">
            <h3 className="text-xl font-bold text-[#1a365d] border-b-2 border-[#1a365d] inline-block pb-1">{section.title}</h3>

            {hasProblems && (
                <div ref={summaryRef} role="alert" className="p-4 rounded-xl border border-red-200 bg-red-50 text-sm text-red-700 scroll-mt-4">
                    <p className="font-bold flex items-center gap-2"><AlertCircle size={16} /> Please fill in every field before moving on:</p>
                    <ul className="mt-2 ml-6 list-disc space-y-0.5">
                        {problems.map((p, i) => <li key={i}>{p.message}</li>)}
                    </ul>
                </div>
            )}

            <div className="space-y-6">
                {section.fields.map((field, i) => {
                    const key = `${field.id}-${i}`;
                    const fieldErrors = problemsFor(field.id);
                    return (
                        <div key={key} className={fieldErrors.length > 0 ? 'rounded-xl ring-2 ring-red-300 ring-offset-4' : undefined}>
                            <FieldInput field={field} data={data} onUpdate={onUpdate} uploadFolder={uploadFolder} />
                            {fieldErrors.map((p, j) => (
                                <p key={j} className="mt-2 text-xs font-semibold text-red-600 flex items-center gap-1"><AlertCircle size={12} /> {p.message}</p>
                            ))}
                        </div>
                    );
                })}
            </div>

            <div className="flex justify-end pt-6">
                {onNext ? (
                    <button type="button" onClick={onNext}
                        className="bg-[#4F65F6] text-white px-10 py-3 rounded-lg font-bold flex items-center space-x-2 hover:bg-[#3d50c2] transition-all shadow-md active:scale-95">
                        <span>Next</span>
                        <ChevronRight size={18} />
                    </button>
                ) : onFinish ? (
                    <button type="button" onClick={onFinish} disabled={!canFinish}
                        className="bg-green-600 text-white px-12 py-3 rounded-lg font-bold flex items-center space-x-2 hover:bg-green-700 transition-all shadow-md active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed">
                        <span>Finish &amp; Submit for Review</span>
                        <ChevronRight size={18} />
                    </button>
                ) : null}
            </div>
        </div>
    );
}

/** The input for one field, by type. */
function FieldInput({ field, data, onUpdate, uploadFolder }: { field: TemplateField } & Pick<Props, 'data' | 'onUpdate' | 'uploadFolder'>) {
    switch (field.type) {
        case 'list':
            return <ListField field={field} data={data} onUpdate={onUpdate} uploadFolder={uploadFolder} />;
        case 'table':
            return <TableField field={field} data={data} onUpdate={onUpdate} />;
        case 'photos':
            return <PhotosField field={field} data={data} onUpdate={onUpdate} uploadFolder={uploadFolder} />;
        case 'attachments':
            return (
                <AttachmentsField fieldId={field.id} uploadLabel={field.label} required={field.required} help={field.help}
                    allowSpreadsheets={field.allowSpreadsheets} data={data} onUpdate={onUpdate} uploadFolder={uploadFolder} />
            );
        case 'preparedBy':
            return <PreparedByField fieldId={field.id} data={data} onUpdate={onUpdate} />;
        default:
            return <ScalarField field={field} data={data} onUpdate={onUpdate} />;
    }
}

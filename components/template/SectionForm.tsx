"use client";

import type { UploadFolder } from '@/lib/files';
import React from 'react';
import { ChevronRight } from 'lucide-react';
import type { ReportValues, TemplateSection } from '@/lib/template';
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
}

/** Renders one template section as a form. */
export default function SectionForm({ section, data, onUpdate, uploadFolder, onNext, onFinish, canFinish = true }: Props) {
    return (
        <div className="space-y-8 animate-in fade-in duration-500 max-w-3xl">
            <h3 className="text-xl font-bold text-[#1a365d] border-b-2 border-[#1a365d] inline-block pb-1">{section.title}</h3>

            <div className="space-y-6">
                {section.fields.map((field, i) => {
                    const key = `${field.id}-${i}`;
                    switch (field.type) {
                        case 'list':
                            return <ListField key={key} field={field} data={data} onUpdate={onUpdate} uploadFolder={uploadFolder} />;
                        case 'table':
                            return <TableField key={key} field={field} data={data} onUpdate={onUpdate} />;
                        case 'photos':
                            return <PhotosField key={key} field={field} data={data} onUpdate={onUpdate} uploadFolder={uploadFolder} />;
                        case 'attachments':
                            return (
                                <AttachmentsField key={key} fieldId={field.id} uploadLabel={field.label} required={field.required} help={field.help}
                                    allowSpreadsheets={field.allowSpreadsheets} data={data} onUpdate={onUpdate} uploadFolder={uploadFolder} />
                            );
                        case 'preparedBy':
                            return <PreparedByField key={key} fieldId={field.id} data={data} onUpdate={onUpdate} />;
                        default:
                            return <ScalarField key={key} field={field} data={data} onUpdate={onUpdate} />;
                    }
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

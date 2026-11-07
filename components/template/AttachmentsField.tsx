"use client";

import type { UploadFolder } from '@/lib/files';
import React, { useState } from 'react';
import { Upload, X, FileText, FileSpreadsheet, AudioLines, Image as ImageIcon } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { ATTACHMENT_ACCEPT, describeUploadError, processAttachment, resolveUploadFolder } from '@/lib/files';
import type { AttachmentFile } from '@/lib/reportData';
import type { ReportValues } from '@/lib/template';

interface AttachmentsFieldProps {
    /** Data key the files are stored under. */
    fieldId: string;
    uploadLabel: string;
    required?: boolean;
    help?: string;
    allowSpreadsheets?: boolean;
    /** False for AI reference material, which is never printed. */
    printed?: boolean;
    data: ReportValues;
    onUpdate: (patch: ReportValues) => void;
    uploadFolder?: UploadFolder;
}

function fileIcon(type: string) {
    if (['xlsx', 'csv'].includes(type)) return <FileSpreadsheet size={20} className="text-green-600" />;
    if (type === 'pdf') return <FileText size={20} className="text-red-500" />;
    if (['webm', 'ogg', 'm4a'].includes(type)) return <AudioLines size={20} className="text-[#3358a8]" />;
    return <ImageIcon size={20} className="text-blue-500" />;
}

/** Upload zone + file list for document attachments (attendance, brochure, notices, ...). */
export default function AttachmentsField({
    fieldId, uploadLabel, required, help, allowSpreadsheets = false, printed = true, data, onUpdate, uploadFolder,
}: AttachmentsFieldProps) {
    const [supabase] = useState(createClient);
    const [isProcessing, setIsProcessing] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const files: AttachmentFile[] = Array.isArray(data[fieldId]) ? (data[fieldId] as AttachmentFile[]) : [];
    const inputId = `${fieldId}-upload`;
    const accept = allowSpreadsheets ? ATTACHMENT_ACCEPT.documentsAndSheets : ATTACHMENT_ACCEPT.documents;
    const formats = allowSpreadsheets ? 'JPG, PNG, PDF or Excel (XLSX/CSV)' : 'JPG, PNG, PDF';

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
        else if (e.type === 'dragleave') setDragActive(false);
    };

    const handleFiles = async (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
        e.preventDefault();
        setDragActive(false);
        const selected = 'dataTransfer' in e ? Array.from(e.dataTransfer.files) : Array.from(e.target.files ?? []);
        if ('target' in e && e.target instanceof HTMLInputElement) e.target.value = '';
        if (selected.length === 0 || !uploadFolder) return;

        setIsProcessing(true);
        const folder = await resolveUploadFolder(uploadFolder).catch(() => null);
        if (!folder) {
            setIsProcessing(false);
            alert('Could not create the draft for this upload. Please try again.');
            return;
        }
        const added: AttachmentFile[] = [];
        const errors: string[] = [];
        for (const file of selected) {
            try {
                added.push(await processAttachment({ supabase, folder }, file, fieldId, allowSpreadsheets));
            } catch (err) {
                console.error('Attachment upload failed:', err);
                errors.push(describeUploadError(err));
            }
        }
        if (added.length > 0) onUpdate({ [fieldId]: [...files, ...added] });
        if (errors.length > 0) alert(errors.join('\n'));
        setIsProcessing(false);
    };

    const removeFile = (id: string) => {
        onUpdate({ [fieldId]: files.filter((f) => f.id !== id) });
    };

    return (
        <div className="space-y-6">
                <div>
                    <label htmlFor={inputId} className="text-sm font-bold text-gray-700 cursor-pointer">
                        {uploadLabel}{required && <span className="text-red-500"> *</span>}
                    </label>
                    {help && <p className="text-xs text-gray-400 mt-0.5">{help}</p>}
                    <p className="text-[10px] text-gray-400 font-medium mt-1 uppercase tracking-wider">Supported format: {formats}</p>
                </div>

                <div
                    className={`relative border-2 border-dashed rounded-3xl p-12 flex flex-col items-center justify-center transition-all group
                        ${dragActive ? 'border-[#4F65F6] bg-[#4F65F6]/5' : 'border-gray-200 bg-gray-50/30 hover:border-[#4F65F6]'}`}
                    onDragOver={handleDrag}
                    onDragLeave={handleDrag}
                    onDrop={handleFiles}
                >
                    <input
                        id={inputId}
                        type="file"
                        multiple
                        className="absolute inset-0 opacity-0 cursor-pointer z-10 w-full h-full"
                        accept={accept}
                        onChange={handleFiles}
                        disabled={isProcessing || !uploadFolder}
                    />
                    <div className="mb-4 p-4 bg-white rounded-full shadow-sm border border-gray-100 group-hover:scale-110 transition-transform">
                        <Upload size={24} className={dragActive ? 'text-[#4F65F6]' : 'text-gray-400'} />
                    </div>
                    <div className="bg-[#4F65F6] text-white px-8 py-2.5 rounded-full font-bold text-xs mb-3 shadow-md group-hover:bg-[#3d50c2] transition-colors">
                        {isProcessing ? 'Uploading...' : 'Browse Files'}
                    </div>
                    <p className="text-xs text-gray-400 text-center font-medium">
                        Drag and drop your files here <br /> {formats}
                    </p>
                </div>

                {files.length > 0 && (
                    <div className="space-y-3 pt-4 border-t border-gray-100">
                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest pb-2">Attached files</h4>
                        <div className="grid grid-cols-1 gap-3">
                            {files.map((file) => (
                                <div key={file.id} className="flex items-center justify-between p-3 bg-white border border-gray-100 rounded-xl shadow-sm">
                                    <div className="flex items-center space-x-3 overflow-hidden">
                                        <div className="p-2 bg-gray-50 rounded-lg">{fileIcon(file.type)}</div>
                                        <div className="flex flex-col">
                                            <span className="text-sm font-medium text-gray-700 truncate max-w-[200px]">{file.name}</span>
                                            {file.jsonData && (
                                                <span className="text-[10px] text-green-600 font-bold">✓ Data extracted ({file.jsonData.length} rows)</span>
                                            )}
                                            {file.type === 'pdf' && file.pages.length > 0 && (
                                                <span className="text-[10px] text-blue-600 font-bold">✓ Processed ({file.pages.length} pages)</span>
                                            )}
                                            {printed && file.pages.length === 0 && !file.jsonData && (
                                                <span className="text-[10px] text-orange-600 font-bold">Not shown in the PDF (re-upload as PDF or image)</span>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => removeFile(file.id)}
                                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors z-20"
                                        title="Remove file"
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
        </div>
    );
}

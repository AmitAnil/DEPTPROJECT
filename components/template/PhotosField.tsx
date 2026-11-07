"use client";

import type { UploadFolder } from '@/lib/files';
import React, { useState } from 'react';
import { Image as ImageIcon, X } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { describeUploadError, resolveUploadFolder, uploadImage } from '@/lib/files';
import { newItemId } from '@/lib/reportData';
import { listValue, textValue, type ReportValues, type TemplateField } from '@/lib/template';
import StoredImage from '@/components/StoredImage';
import { FieldLabel } from './ScalarField';

interface Props {
    field: TemplateField;
    data: ReportValues;
    onUpdate: (patch: ReportValues) => void;
    uploadFolder?: UploadFolder;
}

export default function PhotosField({ field, data, onUpdate, uploadFolder }: Props) {
    const [supabase] = useState(createClient);
    const [isProcessing, setIsProcessing] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const photos = listValue(data, field.id);
    const inputId = `f-${field.id}`;

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
        const images = selected.filter((f) => f.type.startsWith('image/'));
        if (images.length === 0 || !uploadFolder) return;

        setIsProcessing(true);
        const folder = await resolveUploadFolder(uploadFolder).catch(() => null);
        if (!folder) {
            setIsProcessing(false);
            alert('Could not create the draft for this upload. Please try again.');
            return;
        }
        const added: { id: string; url: string; caption: string }[] = [];
        const errors: string[] = [];
        for (const file of images) {
            try {
                added.push({ id: newItemId(), url: await uploadImage({ supabase, folder }, file, field.id), caption: '' });
            } catch (err) {
                console.error('Photo upload failed:', err);
                errors.push(describeUploadError(err));
            }
        }
        if (added.length > 0) onUpdate({ [field.id]: [...photos, ...added] });
        if (errors.length > 0) alert(errors.join('\n'));
        setIsProcessing(false);
    };

    return (
        <div className="space-y-6">
            <div>
                <FieldLabel field={field} htmlFor={inputId} />
                {field.minItems && field.minItems > 1 && (
                    <p className="text-xs text-red-500 font-medium italic mt-1">At least {field.minItems} photos required *</p>
                )}
            </div>

            <div
                className={`relative border-2 border-dashed rounded-3xl p-12 flex flex-col items-center justify-center transition-all group
                    ${dragActive ? 'border-[#4F65F6] bg-[#4F65F6]/5' : 'border-gray-200 bg-gray-50/30 hover:border-[#4F65F6]'}`}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleFiles}
            >
                <input id={inputId} type="file" multiple accept="image/*" onChange={handleFiles} disabled={isProcessing || !uploadFolder}
                    className="absolute inset-0 opacity-0 cursor-pointer z-10 w-full h-full" />
                <div className="mb-4 p-4 bg-white rounded-full shadow-sm border border-gray-100 group-hover:scale-110 transition-transform">
                    <ImageIcon size={24} className={dragActive ? 'text-[#4F65F6]' : 'text-gray-400'} />
                </div>
                <div className="bg-[#4F65F6] text-white px-8 py-2.5 rounded-full font-bold text-xs mb-3 shadow-md group-hover:bg-[#3d50c2] transition-colors">
                    {isProcessing ? 'Uploading...' : 'Browse Images'}
                </div>
                <p className="text-xs text-gray-400 text-center font-medium">Drag and drop your images here <br /> JPG, PNG, WEBP</p>
            </div>

            {photos.length > 0 && (
                <div className="grid grid-cols-2 gap-6 mt-8">
                    {photos.map((photo) => (
                        <div key={photo.id} className="relative group border rounded-2xl overflow-hidden bg-white shadow-sm flex flex-col">
                            <button type="button" onClick={() => onUpdate({ [field.id]: photos.filter((p) => p.id !== photo.id) })} title="Remove photo"
                                className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow-md hover:bg-red-600">
                                <X size={14} />
                            </button>
                            <div className="aspect-video bg-gray-100 flex items-center justify-center overflow-hidden">
                                <StoredImage src={textValue(photo, 'url')} alt={textValue(photo, 'caption') || 'Photo'} className="w-full h-full object-cover" />
                            </div>
                            <div className="p-3 bg-white border-t">
                                <input type="text" placeholder="Add a caption..." value={textValue(photo, 'caption')}
                                    onChange={(e) => onUpdate({ [field.id]: photos.map((p) => (p.id === photo.id ? { ...p, caption: e.target.value } : p)) })}
                                    className="w-full text-xs p-2 border-b outline-none focus:border-[#4F65F6] bg-transparent text-gray-800" />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
